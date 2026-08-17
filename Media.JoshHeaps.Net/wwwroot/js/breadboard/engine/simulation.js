/**
 * Event-driven simulation core.
 *
 * MUTABLE HOT PATH. Owns the event queue, the driver table and the device
 * instances. Models talk to it through the context methods on this class; they
 * never reach into its buffers.
 *
 * Scheduling model
 * ----------------
 * Events carry (timeNs, seq) so equal-time events fire in insertion order and
 * the whole run is reproducible whatever order components appear in the
 * document. Applying a driver change resolves its net in O(1) and, only if the
 * resolved LEVEL actually moved, wakes the devices listening on that net. Waking
 * a device is a direct call, not another queue entry — the queue holds delayed
 * *effects*, not intentions, which halves event volume.
 *
 * Delay is INERTIAL, not transport. If a gate's input moves again before its
 * pending output event fires, the pending event is cancelled rather than
 * queued behind it, so a pulse narrower than the gate's tPD is swallowed the
 * way a real gate swallows it. Cancellation is O(1): every driver carries a
 * generation counter, scheduling bumps it, and an event whose generation no
 * longer matches is dropped when popped. The heap is never scanned.
 *
 * Two independent limits, which must not be confused
 * --------------------------------------------------
 *  1. The delta-cycle guard counts events resolved at ONE UNCHANGED simTime.
 *     Exceeding it means a combinational loop with no delay, so time can never
 *     advance — a genuine fault, reported as an "oscillation" warning, and the
 *     sim pauses.
 *  2. The per-batch budget in `runEvents` is cooperative yielding, nothing more.
 *     It exists so the worker returns to its message loop and stays responsive.
 *     A 74HC04 ring oscillator hits it constantly and that is entirely healthy:
 *     simTime advances on every event, so the delta guard never sees it.
 */

import { LEVEL_HIGHZ, MAX_EVENTS_PER_INSTANT, NO_NET, STRENGTH_HIGHZ } from './constants.js';
import { DRIVE_HIGHZ, FAULT_NONE, FAULT_CONTENTION, FAULT_SHORT_CIRCUIT } from './drive.js';
import { EventQueue, EVENT_DRIVE, EVENT_TIMER } from './event-queue.js';
import { NetState } from './net-state.js';
import { buildNets } from './net-builder.js';
import { registry as defaultRegistry, WAKE_INIT, WAKE_PIN, WAKE_TIMER } from './models/index.js';
import { RESISTOR_TYPE } from './models/resistor.js';
import { LED_TYPE } from './models/led.js';

/** Packs (strength, value) into the small code carried by a queued event. */
function packCode(strength, value) {
	return strength === STRENGTH_HIGHZ ? 0 : strength * 2 + (value ? 1 : 0);
}

const MAX_OSCILLATION_CULPRITS = 12;
/** Cap on self-short reports per document, so a pathological circuit cannot flood. */
const MAX_SELF_SHORT_WARNINGS = 20;
/** Ring buffer of the most recent drivers applied at one instant, for diagnostics. */
const DELTA_RING_SIZE = 32;
const DELTA_RING_MASK = DELTA_RING_SIZE - 1;

export class Simulation {
	/**
	 * @param {object} circuit  circuit document v1
	 * @param {object} [options]
	 * @param {object} [options.registry]  model registry (tests may substitute)
	 * @param {Map<string,number>} [options.delayOverridesNs]  per-type delay override,
	 *   used by tests to force zero-delay loops
	 */
	constructor(circuit, options = {}) {
		this.registry = options.registry ?? defaultRegistry;
		this.delayOverridesNs = options.delayOverridesNs ?? null;

		const extraction = buildNets(circuit, this.registry);
		this.netCount = extraction.netCount;
		this.netOfStrip = extraction.netOfStrip;
		this.warnings = extraction.warnings.slice();

		this.queue = new EventQueue(1024);
		this.timeNs = 0;
		this.halted = false;
		this.haltReason = null;

		this.#buildDevices(circuit, extraction.pinNets);
		this.#buildListeners();
		this.#buildSeriesResistance();
		this.#checkSelfShorts(circuit);

		// Reused across every model wake so evaluation allocates nothing.
		this.wake = { reason: WAKE_INIT, pin: -1, prevLevel: 0, level: 0, timerId: 0 };

		this.netFaultReported = new Uint8Array(this.netCount);
		this.shortedNetCount = 0;
		// Depth of nested model evaluation. Guards `driveNow` and documents the
		// invariant that `wake` and model scratch buffers are only safe because
		// evaluation never re-enters itself.
		this.evaluating = 0;
		this.deltaTimeNs = -1;
		this.deltaCount = 0;
		this.deltaRing = new Int32Array(DELTA_RING_SIZE).fill(-1);
		this.deltaRingCount = 0;
		this.oscillationReported = false;

		this.#initDevices();
	}

	/* ---------------------------------------------------------------- *
	 * Construction
	 * ---------------------------------------------------------------- */

	#buildDevices(circuit, pinNets) {
		const components = Array.isArray(circuit?.components) ? circuit.components : [];
		this.devices = [];
		this.deviceByUid = new Map();
		this.ledOrder = [];

		let driverCapacityHint = 0;
		for (const component of components) {
			const model = this.registry.get(component?.type);
			if (!model) {
				if (component?.type) {
					this.warnings.push({
						kind: 'unknownComponent',
						detail: `no simulation model for component type "${component.type}"`,
						uids: [component.uid],
					});
				}
				continue;
			}
			const nets = pinNets.get(component.uid);
			if (!nets) continue;

			const index = this.devices.length;
			const pinCount = Math.max(model.pinCount, nets.length);
			const pins = new Int32Array(pinCount).fill(NO_NET);
			pins.set(nets.subarray(0, Math.min(nets.length, pinCount)));

			const inst = {
				index,
				uid: component.uid,
				type: component.type,
				model,
				props: component.props ?? {},
				state: model.createState ? model.createState(component) : null,
				pins,
				drivers: new Int32Array(pinCount).fill(-1),
				delayNs: this.#delayFor(model),
				ledOrdinal: -1,
			};
			this.devices.push(inst);
			this.deviceByUid.set(component.uid, inst);
			if (component.type === LED_TYPE) {
				inst.ledOrdinal = this.ledOrder.length;
				this.ledOrder.push(component.uid);
			}
			driverCapacityHint += pinCount;
		}

		// Every connected pin owns a driver from the start, whether or not the
		// model ever drives it. That is what makes pin direction a runtime
		// property: a model can assert or release any pin at any moment without
		// the engine having been told in advance which pins are outputs.
		this.nets = new NetState(this.netCount, Math.max(64, driverCapacityHint));
		this.driverOwner = new Int32Array(Math.max(64, driverCapacityHint)).fill(-1);
		for (const inst of this.devices) {
			for (let pin = 0; pin < inst.pins.length; pin++) {
				if (inst.pins[pin] === NO_NET) continue;
				const driverId = this.nets.addDriver(inst.pins[pin]);
				inst.drivers[pin] = driverId;
				if (driverId >= this.driverOwner.length) this.#growDriverOwners(driverId + 1);
				this.driverOwner[driverId] = inst.index;
			}
		}
		// Float64, matching event-queue's `seq` for the same reason: these are
		// unbounded monotonic counters, and an int32 that silently wraps turns a
		// stale event into a live one. Practically unreachable, but the cost of
		// consistency here is zero.
		this.driverGen = new Float64Array(this.nets.driverCount + 1);
		this.driverPending = new Int32Array(this.nets.driverCount + 1).fill(-1);
		this.ledCurrentsMilliamps = new Float32Array(this.ledOrder.length);
	}

	#growDriverOwners(minimum) {
		let capacity = this.driverOwner.length * 2;
		while (capacity < minimum) capacity *= 2;
		const owner = new Int32Array(capacity).fill(-1);
		owner.set(this.driverOwner);
		this.driverOwner = owner;
	}

	#delayFor(model) {
		if (this.delayOverridesNs) {
			const override = this.delayOverridesNs.get(model.type);
			if (override !== undefined) return override;
		}
		return model.delayNs;
	}

	/**
	 * Net -> listening (device, pin) pairs, in compressed sparse row form. A flat
	 * pair of typed arrays plus an offset table keeps wake dispatch to one
	 * contiguous scan instead of chasing per-net sub-arrays.
	 */
	#buildListeners() {
		const counts = new Int32Array(this.netCount + 1);
		let total = 0;
		for (const inst of this.devices) {
			for (let pin = 0; pin < inst.pins.length; pin++) {
				const net = inst.pins[pin];
				if (net === NO_NET) continue;
				counts[net + 1]++;
				total++;
			}
		}
		for (let i = 0; i < this.netCount; i++) counts[i + 1] += counts[i];
		this.listenerStart = counts;
		this.listenerDevice = new Int32Array(total);
		this.listenerPin = new Uint8Array(total);

		const cursor = counts.slice(0, this.netCount);
		for (const inst of this.devices) {
			for (let pin = 0; pin < inst.pins.length; pin++) {
				const net = inst.pins[pin];
				if (net === NO_NET) continue;
				const slot = cursor[net]++;
				this.listenerDevice[slot] = inst.index;
				this.listenerPin[slot] = pin;
			}
		}
	}

	/** Smallest resistor touching each net, for LED series-resistance lookup. */
	#buildSeriesResistance() {
		/** @type {Map<number, number>} */
		this.minOhmsByNet = new Map();
		for (const inst of this.devices) {
			if (inst.type !== RESISTOR_TYPE) continue;
			const ohms = inst.state?.ohms;
			if (!Number.isFinite(ohms)) continue;
			for (let pin = 0; pin < 2; pin++) {
				const net = inst.pins[pin];
				if (net === NO_NET) continue;
				const existing = this.minOhmsByNet.get(net);
				if (existing === undefined || ohms < existing) this.minOhmsByNet.set(net, ohms);
			}
		}
	}

	/**
	 * Load-time only: reports components whose own terminals share a net, which
	 * makes the component electrically inert.
	 *
	 * This is worth a warning precisely because it is INVISIBLE. An LED wired
	 * across a single terminal strip reports 0 mA — and 0 mA is also what a
	 * normally-off LED reports, so neither the user nor the UI can tell the
	 * difference between "not lit right now" and "can never light". Same for a
	 * resistor bridged across one strip (silently contributing nothing) and a
	 * switch whose two contacts are already common (pressing it does nothing).
	 *
	 * Two sources, because neither alone is sufficient:
	 *   - GEOMETRY, via shared's componentSelfShorts: both legs placed in one
	 *     strip. Already excludes pins bonded by design, so a push button's 1-2
	 *     and 3-4 never appear.
	 *   - NETS: the same pin pairs resolved through union-find, which also
	 *     catches a short made by a WIRE rather than by placement — invisible to
	 *     geometry, and just as dead. Design ties are subtracted here too.
	 *
	 * Never emitted at runtime, and capped per document.
	 */
	#checkSelfShorts(circuit) {
		const components = Array.isArray(circuit?.components) ? circuit.components : [];
		let emitted = 0;
		for (const component of components) {
			if (emitted >= MAX_SELF_SHORT_WARNINGS) break;
			const inst = this.deviceByUid.get(component?.uid);
			if (!inst) continue;

			const seen = new Set();
			const offending = [];
			const record = (a, b, cause) => {
				const key = a < b ? `${a}:${b}` : `${b}:${a}`;
				if (seen.has(key)) return;
				seen.add(key);
				offending.push({ a, b, cause });
			};

			for (const [a, b] of this.registry.selfShorts(component)) record(a, b, 'placed in the same terminal strip');
			for (const [a, b] of this.registry.functionalPairs(component)) {
				const netA = inst.pins[a];
				const netB = inst.pins[b];
				if (netA >= 0 && netA === netB) record(a, b, 'connected to the same net');
			}
			if (offending.length === 0) continue;

			emitted++;
			const described = offending.map((o) => `pins ${o.a + 1} and ${o.b + 1} are ${o.cause}`).join('; ');
			this.warnings.push({
				kind: 'selfShorted',
				uids: [inst.uid],
				netId: inst.pins[offending[0].a],
				detail: `${inst.type} ${inst.uid} is shorted across itself and can have no effect: ${described}`,
			});
		}
	}

	#initDevices() {
		this.wake.reason = WAKE_INIT;
		this.wake.pin = -1;
		for (const inst of this.devices) {
			if (inst.model.init) inst.model.init(this, inst);
		}
		for (const inst of this.devices) {
			this.wake.reason = WAKE_INIT;
			this.wake.pin = -1;
			this.#evaluate(inst, this.wake);
		}
	}

	/* ---------------------------------------------------------------- *
	 * Model-facing context
	 * ---------------------------------------------------------------- */

	/*
	 * PIN ACCESSORS FAIL CLOSED — note the `>= 0` tests rather than `< 0`.
	 * Reading a typed array past its end yields `undefined`, and `undefined < 0`
	 * is FALSE, so a `< 0` guard lets an out-of-range pin through. It then
	 * indexes a real driver (commonly driver 0, which is live on a live net) and
	 * silently drives an unrelated part of the circuit. `>= 0` is false for
	 * `undefined`, so the bad pin is rejected instead of aliased.
	 */

	level(inst, pin) {
		const net = inst.pins[pin];
		return net >= 0 ? this.nets.levels[net] : LEVEL_HIGHZ;
	}

	netOf(inst, pin) {
		const net = inst.pins[pin];
		return net >= 0 ? net : NO_NET;
	}

	levelExcludingSelf(inst, pin) {
		const net = inst.pins[pin];
		const driverId = inst.drivers[pin];
		if (!(net >= 0) || !(driverId >= 0)) return LEVEL_HIGHZ;
		return this.nets.levelExcluding(net, driverId);
	}

	driveExcludingSelf(inst, pin) {
		const net = inst.pins[pin];
		const driverId = inst.drivers[pin];
		if (!(net >= 0) || !(driverId >= 0)) return DRIVE_HIGHZ;
		return this.nets.driveExcluding(net, driverId);
	}

	/**
	 * Schedules a driver change `delayNs` from now, with inertial semantics: a
	 * still-pending change on the same driver is cancelled, and a request that
	 * matches what is already pending (or already applied) costs nothing.
	 */
	drive(inst, pin, strength, value, delayNs) {
		const driverId = inst.drivers[pin];
		if (!(driverId >= 0)) return;
		const code = packCode(strength, value);
		const currentCode = packCode(this.nets.driverStrength[driverId], this.nets.driverValue[driverId]);
		const pending = this.driverPending[driverId];
		const effective = pending >= 0 ? pending : currentCode;
		if (code === effective) return;

		this.driverGen[driverId]++;
		if (code === currentCode) {
			// The input moved back before the pending edge fired: glitch swallowed.
			this.driverPending[driverId] = -1;
			return;
		}
		this.driverPending[driverId] = code;
		const delay = delayNs === undefined ? inst.delayNs : delayNs;
		this.queue.push(this.timeNs + delay, EVENT_DRIVE, driverId, code, this.driverGen[driverId]);
	}

	/**
	 * Applies a driver change immediately, bypassing the queue.
	 *
	 * SAFE TO CALL FROM `evaluate`. Applying immediately from inside a model's
	 * evaluate would re-enter #applyDriver -> #propagate, which clobbers the
	 * shared `wake` record mid-loop and hands every remaining listener the wrong
	 * pin — a silent wrong answer, not a crash. Rather than document that as a
	 * rule for future model authors to remember, the hazard is removed: during
	 * evaluation this degrades to a zero-delay queued change, which lands in the
	 * same sim instant and goes through the normal, non-reentrant path.
	 */
	driveNow(inst, pin, strength, value) {
		const driverId = inst.drivers[pin];
		if (!(driverId >= 0)) return;
		if (this.evaluating > 0) {
			this.drive(inst, pin, strength, value, 0);
			return;
		}
		this.driverGen[driverId]++;
		this.driverPending[driverId] = -1;
		this.#applyDriver(driverId, strength, value);
	}

	/** Wakes this device again at `timeNs + deltaNs` with no input change. */
	scheduleSelf(inst, deltaNs, timerId = 0) {
		if (!(inst?.index >= 0) || !Number.isFinite(deltaNs) || deltaNs < 0) return;
		this.queue.push(this.timeNs + deltaNs, EVENT_TIMER, inst.index, timerId, 0);
	}

	warn(kind, uids, netId, detail) {
		this.warnings.push({ kind, uids, netId, detail });
	}

	/** A load-time issue: reported once in the `loaded` message, never repeated. */
	staticWarning(kind, detail, uids) {
		this.warnings.push({ kind, detail, uids });
	}

	setLedCurrent(inst, amps) {
		if (inst.ledOrdinal >= 0) this.ledCurrentsMilliamps[inst.ledOrdinal] = amps * 1000;
	}

	/**
	 * How many component pins sit on `netId`. A pin whose net has no other
	 * occupant is genuinely floating — nothing can ever drive it — which is how
	 * models tell "unwired input" apart from "input not driven yet at load".
	 */
	netListenerCount(netId) {
		if (netId === NO_NET) return 0;
		return this.listenerStart[netId + 1] - this.listenerStart[netId];
	}

	/** Smallest resistance touching `netId`, or 0 when nothing limits it. */
	dominantSeriesOhms(netId) {
		if (netId === NO_NET) return 0;
		return this.minOhmsByNet.get(netId) ?? 0;
	}

	/* ---------------------------------------------------------------- *
	 * Running
	 * ---------------------------------------------------------------- */

	/**
	 * Processes up to `budget` events.
	 * @returns {number} events actually processed. Fewer than the budget means
	 *   the circuit settled or the sim halted; neither is an error.
	 */
	runEvents(budget) {
		const queue = this.queue;
		let processed = 0;
		while (processed < budget && !this.halted && queue.size > 0) {
			// The delta check reads the NEXT event's time before popping, so a
			// guard trip leaves that event in the queue. Losing it would make the
			// circuit look settled on the next run, hiding the fault instead of
			// reporting it again.
			const nextTime = queue.peekTime();
			if (nextTime === this.deltaTimeNs) {
				if (++this.deltaCount > MAX_EVENTS_PER_INSTANT) {
					this.#reportOscillation();
					break;
				}
			} else {
				this.deltaTimeNs = nextTime;
				this.deltaCount = 0;
				this.deltaRingCount = 0;
			}

			queue.pop();
			this.timeNs = queue.outTime;

			if (queue.outKind === EVENT_DRIVE) {
				const driverId = queue.outTarget;
				if (queue.outGen === this.driverGen[driverId]) {
					this.driverPending[driverId] = -1;
					this.deltaRing[this.deltaRingCount++ & DELTA_RING_MASK] = driverId;
					this.#applyDriver(driverId, queue.outArg >> 1, queue.outArg & 1);
				}
			} else {
				const inst = this.devices[queue.outTarget];
				this.wake.reason = WAKE_TIMER;
				this.wake.pin = -1;
				this.wake.timerId = queue.outArg;
				this.#evaluate(inst, this.wake);
			}
			processed++;
		}
		return processed;
	}

	/** True when nothing more will happen without outside input. */
	get isSettled() {
		return this.queue.size === 0;
	}

	/**
	 * Clears a halt and the delta counter so the user can run or step again.
	 * A short circuit is the exception: resuming into a still-shorted supply
	 * would let the sim run in a state that would have destroyed real hardware,
	 * so the halt stands until the offending connection is removed. The warning
	 * is not re-emitted — the fault is already latched per net.
	 *
	 * @returns {boolean} whether the simulation is now runnable.
	 */
	resume() {
		if (this.shortedNetCount > 0) {
			this.halted = true;
			this.haltReason = 'shortCircuit';
			return false;
		}
		this.halted = false;
		this.haltReason = null;
		this.deltaTimeNs = -1;
		this.deltaCount = 0;
		this.deltaRingCount = 0;
		return true;
	}

	#applyDriver(driverId, strength, value) {
		const nets = this.nets;
		const netId = nets.driverNet[driverId];
		const prevLevel = nets.levelOf(netId);
		if (!nets.setDriver(driverId, strength, value)) {
			// The level held, but the fault classification may still have moved
			// (a second driver of the same polarity arriving, say).
			this.#checkFault(netId);
			return;
		}
		this.#checkFault(netId);
		this.#propagate(netId, prevLevel, nets.levelOf(netId));
	}

	/**
	 * The single place a model's `evaluate` is invoked. Everything that makes
	 * evaluation allocation-free — the reused `wake` record, the shared input
	 * scratch buffer in logic-ic.js — depends on evaluation never re-entering
	 * itself, so the depth counter lives here rather than at each call site.
	 */
	#evaluate(inst, wake) {
		this.evaluating++;
		inst.model.evaluate(this, inst, wake);
		this.evaluating--;
	}

	#propagate(netId, prevLevel, newLevel) {
		const start = this.listenerStart[netId];
		const end = this.listenerStart[netId + 1];
		const wake = this.wake;
		for (let i = start; i < end; i++) {
			const inst = this.devices[this.listenerDevice[i]];
			wake.reason = WAKE_PIN;
			wake.pin = this.listenerPin[i];
			wake.prevLevel = prevLevel;
			wake.level = newLevel;
			this.#evaluate(inst, wake);
		}
	}

	#checkFault(netId) {
		const fault = this.nets.faultOf(netId);
		const previous = this.netFaultReported[netId];
		if (fault === previous) return;
		if (previous === FAULT_SHORT_CIRCUIT) this.shortedNetCount--;
		if (fault === FAULT_SHORT_CIRCUIT) this.shortedNetCount++;
		this.netFaultReported[netId] = fault;
		if (fault === FAULT_NONE) return;

		const uids = this.#driversOnNet(netId);
		if (fault === FAULT_SHORT_CIRCUIT) {
			this.halted = true;
			this.haltReason = 'shortCircuit';
			this.warn('shortCircuit', uids, netId, `net ${netId} ties the 5V rail directly to ground`);
		} else if (fault === FAULT_CONTENTION) {
			this.warn('contention', uids, netId, `net ${netId} is driven high and low at the same time`);
		}
	}

	/** uids of every device with a pin on `netId`, for warning payloads. */
	#driversOnNet(netId) {
		const uids = [];
		const start = this.listenerStart[netId];
		const end = this.listenerStart[netId + 1];
		for (let i = start; i < end; i++) {
			const uid = this.devices[this.listenerDevice[i]].uid;
			if (!uids.includes(uid)) uids.push(uid);
		}
		return uids;
	}

	#reportOscillation() {
		this.halted = true;
		this.haltReason = 'oscillation';
		if (this.oscillationReported) return;
		this.oscillationReported = true;

		// Name the participants from the drivers most recently applied at this
		// same timestamp, plus whatever is still queued for it. Between them
		// those are exactly the elements going round the loop.
		const uids = [];
		const netIds = [];
		const note = (driverId) => {
			if (driverId < 0 || uids.length >= MAX_OSCILLATION_CULPRITS) return;
			const owner = this.driverOwner[driverId];
			if (owner >= 0) {
				const uid = this.devices[owner].uid;
				if (!uids.includes(uid)) uids.push(uid);
			}
			const netId = this.nets.driverNet[driverId];
			if (netId >= 0 && !netIds.includes(netId)) netIds.push(netId);
		};
		for (let i = 0; i < DELTA_RING_SIZE; i++) note(this.deltaRing[i]);
		const queue = this.queue;
		for (let i = 0; i < queue.length; i++) {
			if (queue.time[i] === this.deltaTimeNs && queue.kind[i] === EVENT_DRIVE) note(queue.target[i]);
		}
		this.warnings.push({
			kind: 'oscillation',
			uids,
			netId: netIds.length > 0 ? netIds[0] : -1,
			detail:
				`circuit will not settle: over ${MAX_EVENTS_PER_INSTANT} events resolved at ${this.deltaTimeNs} ns ` +
				`without simulated time advancing. Zero-delay feedback loop through net(s) ${netIds.join(', ')}` +
				(uids.length > 0 ? ` and component(s) ${uids.join(', ')}` : '') +
				'. Simulation paused.',
		});
	}

	/* ---------------------------------------------------------------- *
	 * Outside world
	 * ---------------------------------------------------------------- */

	/** Handles a `{ type:"input", uid, value }` message. */
	applyInput(uid, value) {
		const inst = this.deviceByUid.get(uid);
		if (!inst || !inst.model.applyInput) return false;
		inst.model.applyInput(this, inst, value);
		return true;
	}

	/**
	 * Net map handed to the UI once at load, so it can colour holes and wires
	 * straight from `frame.netLevels` without re-deriving connectivity.
	 * Unconnected pins are -1.
	 */
	netIndex() {
		const strips = {};
		for (const [key, netId] of this.netOfStrip) strips[key] = netId;
		const components = {};
		for (const inst of this.devices) components[inst.uid] = Array.from(inst.pins);
		return { strips, components, ledOrder: this.ledOrder.slice() };
	}

	/** Drains accumulated warnings. Callers own the returned array. */
	drainWarnings() {
		if (this.warnings.length === 0) return [];
		const drained = this.warnings;
		this.warnings = [];
		return drained;
	}

	/** Runs to quiescence, bounded. Used right after load. */
	settle(maxEvents = 200000) {
		return this.runEvents(maxEvents);
	}
}

export { EVENT_DRIVE, EVENT_TIMER };
