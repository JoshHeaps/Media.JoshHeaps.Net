/**
 * Module Web Worker hosting the simulation. Speaks the spec's protocol.
 *
 * Main -> worker:
 *   { type:"load", circuit }
 *   { type:"run" } | { type:"pause" } | { type:"step", count }
 *   { type:"setSpeed", eventsPerSecond }
 *   { type:"input", uid, value }
 *   { type:"reset" }
 *
 * Worker -> main:
 *   { type:"loaded", nets, warnings, netIndex }
 *   { type:"frame", netLevels, ledStates, simTimeNs, running, settled, halted }
 *   { type:"warning", kind, uids, netId, detail }
 *   { type:"error", context, message }
 *
 * This file's whole job is to keep the main thread healthy. The simulation can
 * legitimately produce millions of events and hundreds of thousands of warnings
 * per second; none of that may reach the UI at that rate. Three independent
 * limiters enforce that, and they are independent ON PURPOSE — each bounds a
 * different resource, and collapsing them would leave a hole:
 *
 *   1. TIME per tick (`TICK_BUDGET_MS`) bounds how long the worker can be deaf
 *      to incoming messages. A count-based budget cannot do this job: per-event
 *      cost is circuit-dependent, so any fixed event count is simultaneously too
 *      slow on a heavy circuit and too coarse on a light one. The budget is
 *      checked every `EVENTS_PER_TIME_CHECK` events, so `pause` is always heard
 *      within a few milliseconds regardless of what the circuit is doing.
 *   2. FRAMES per second (`FRAME_HZ`) bounds render pressure. EVERY frame goes
 *      through `requestFrame`, including the ones triggered by pause, step,
 *      input and load — a UI sending an input per mousemove would otherwise
 *      punch straight through the throttle. Suppressed frames are not dropped:
 *      a trailing-edge timer flushes the final state, so the UI can never be
 *      left showing something stale.
 *   3. WARNINGS per tick and per key (`MAX_WARNINGS_PER_TICK`,
 *      `WARNING_COOLDOWN_MS`) bound message volume. See `flushWarnings`.
 *
 * `eventsPerSecond` remains the user-facing SPEED control and is applied on top
 * of the time budget; whichever binds first wins.
 *
 * Frame buffers are allocated per frame rather than double-buffered. They are
 * TRANSFERRED, which neuters them on this side, so a reused buffer would come
 * back detached and throw; and at 60 Hz a few kilobytes is far below the noise
 * floor of anything else the worker does.
 */

import { Simulation } from './simulation.js';

const FRAME_HZ = 60;
const FRAME_INTERVAL_MS = 1000 / FRAME_HZ;
const DEFAULT_EVENTS_PER_SECOND = 1_000_000;

/** Wall-clock ceiling for one tick, so `pause` is never more than this away. */
const TICK_BUDGET_MS = 8;
/** How often the time budget is consulted. Small enough to be responsive. */
const EVENTS_PER_TIME_CHECK = 4096;

/** At most this many `warning` messages leave the worker per tick. */
const MAX_WARNINGS_PER_TICK = 20;
/** The same warning identity is not re-sent more often than this. */
const WARNING_COOLDOWN_MS = 1000;
/** Cap on remembered warning identities, so the dedupe map cannot grow forever. */
const MAX_WARNING_KEYS = 500;

/** @type {Simulation|null} */
let sim = null;
let circuit = null;
let running = false;
let eventsPerSecond = DEFAULT_EVENTS_PER_SECOND;
let timer = null;

let lastFrameAt = -Infinity;
let frameTimer = null;

/** key -> timestamp last posted, for warning dedupe across ticks. */
const warningLastPosted = new Map();
let suppressedWarnings = 0;
let lastSuppressionReportAt = -Infinity;

function now() {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function post(message, transfers) {
	self.postMessage(message, transfers ?? []);
}

/* ------------------------------------------------------------------ *
 * Warnings
 * ------------------------------------------------------------------ */

/**
 * Identity of a warning for dedupe purposes. Deliberately excludes `detail`,
 * which carries changing numbers (a fluctuating current, a timestamp) and would
 * make every repeat look unique — which is precisely how an unbounded flood
 * gets through a naive dedupe.
 */
function warningKey(warning) {
	return `${warning.kind}|${warning.netId ?? -1}|${(warning.uids ?? []).join(',')}`;
}

/**
 * Posts warnings under a hard budget.
 *
 * A warning is a NOTIFICATION, not a log entry. The engine may generate them at
 * event rate — an LED driven at 25 mA by a running oscillator crosses the 20 mA
 * threshold on every cycle, which is hundreds of thousands of warnings per
 * second, and contention on a toggling net does the same. Posting one message
 * each would wedge the main thread, which is the single failure this worker
 * exists to prevent.
 *
 * So: identical warnings are collapsed by identity with a cooldown, at most
 * MAX_WARNINGS_PER_TICK escape per tick, and anything held back is reported as
 * a single coalesced count rather than silently dropped. Bounding it HERE
 * rather than in the models covers every warning kind at once, including kinds
 * added later.
 */
function flushWarnings() {
	if (!sim) return;
	const drained = sim.drainWarnings();
	if (drained.length === 0 && suppressedWarnings === 0) return;

	const at = now();
	if (warningLastPosted.size > MAX_WARNING_KEYS) warningLastPosted.clear();

	let emitted = 0;
	for (const warning of drained) {
		const key = warningKey(warning);
		const last = warningLastPosted.get(key);
		if (last !== undefined && at - last < WARNING_COOLDOWN_MS) {
			suppressedWarnings++;
			continue;
		}
		if (emitted >= MAX_WARNINGS_PER_TICK) {
			suppressedWarnings++;
			continue;
		}
		warningLastPosted.set(key, at);
		emitted++;
		post({
			type: 'warning',
			kind: warning.kind,
			uids: warning.uids ?? [],
			netId: warning.netId ?? -1,
			detail: warning.detail ?? '',
		});
	}

	if (suppressedWarnings > 0 && at - lastSuppressionReportAt >= WARNING_COOLDOWN_MS) {
		const count = suppressedWarnings;
		suppressedWarnings = 0;
		lastSuppressionReportAt = at;
		post({
			type: 'warning',
			kind: 'warningsSuppressed',
			uids: [],
			netId: -1,
			detail: `${count} further warning${count === 1 ? '' : 's'} suppressed — the circuit is repeating a fault every cycle`,
		});
	}
}

function resetWarningThrottle() {
	warningLastPosted.clear();
	suppressedWarnings = 0;
	lastSuppressionReportAt = -Infinity;
}

/**
 * Turns an unexpected throw into something the UI can show.
 *
 * Without this, any throw escapes as an unhandled worker error: the protocol
 * has no error path, so main never gets `loaded`, never gets a `frame`, and
 * never learns why — the UI simply waits forever on a dead worker. A silent
 * hang is the worst possible failure mode, so every entry point funnels here.
 *
 * The failure is reported as the top-level `{ type:"error", context, message }`
 * rather than as a `warning`. The runtime `warning.kind` enum is CLOSED, so an
 * engine fault is not expressible in it — and an engine fault is categorically
 * different anyway: a warning describes the user's circuit, an error describes
 * the simulator failing to run at all.
 */
function reportEngineError(context, error) {
	running = false;
	stopTimer();
	const message = error?.message ?? String(error);
	try {
		post({ type: 'error', context, message });
		// `{type:"error"}` alone still leaves a `load` caller blocked on the
		// `loaded` it is waiting for, so answer that too. Inside
		// `loaded.warnings` the kind set is open, so `loadFailed` is legal there.
		if (context === 'load' && !sim) {
			post({
				type: 'loaded',
				nets: 0,
				warnings: [{ kind: 'loadFailed', uids: [], netId: -1, detail: `circuit failed to load: ${message}` }],
				netIndex: { strips: {}, components: {}, ledOrder: [] },
			});
		}
	} catch {
		// postMessage itself failed; nothing further is possible.
	}
}

/* ------------------------------------------------------------------ *
 * Frames
 * ------------------------------------------------------------------ */

function postFrame() {
	if (!sim) return;
	clearFrameTimer();
	// Fresh buffers: these are transferred and neutered on the way out.
	const netLevels = new Uint8Array(sim.nets.levels);
	const ledStates = new Float32Array(sim.ledCurrentsMilliamps);
	lastFrameAt = now();
	post(
		{
			type: 'frame',
			netLevels,
			ledStates,
			simTimeNs: sim.timeNs,
			running,
			settled: sim.isSettled,
			halted: sim.halted,
		},
		[netLevels.buffer, ledStates.buffer],
	);
}

function clearFrameTimer() {
	if (frameTimer !== null) {
		clearTimeout(frameTimer);
		frameTimer = null;
	}
}

/**
 * The ONLY way a frame leaves this worker. Emits immediately when the throttle
 * allows, otherwise arms a trailing-edge timer so the final state still arrives
 * — a suppressed frame is delayed, never dropped, or the UI would be left
 * rendering a stale circuit.
 */
function requestFrame(force = false) {
	if (!sim) return;
	const since = now() - lastFrameAt;
	if (force || since >= FRAME_INTERVAL_MS) {
		postFrame();
		return;
	}
	if (frameTimer === null) frameTimer = setTimeout(postFrame, Math.max(0, FRAME_INTERVAL_MS - since));
}

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

function stopTimer() {
	if (timer !== null) {
		clearTimeout(timer);
		timer = null;
	}
}

function scheduleTick() {
	stopTimer();
	if (!running) return;
	timer = setTimeout(tick, FRAME_INTERVAL_MS);
}

/** Events allowed this tick by the user's speed setting. */
function speedBudget() {
	return Math.max(1, Math.round(eventsPerSecond / FRAME_HZ));
}

/**
 * Runs up to `eventBudget` events, but never for longer than TICK_BUDGET_MS.
 * Time is checked every EVENTS_PER_TIME_CHECK events rather than every event,
 * so the clock read is amortised to nothing on the hot path.
 */
function runBudgeted(eventBudget) {
	if (!sim) return 0;
	const deadline = now() + TICK_BUDGET_MS;
	let processed = 0;
	while (processed < eventBudget && !sim.halted) {
		const chunk = Math.min(EVENTS_PER_TIME_CHECK, eventBudget - processed);
		const did = sim.runEvents(chunk);
		processed += did;
		if (did < chunk) break; // settled, or halted mid-chunk
		if (now() >= deadline) break;
	}
	return processed;
}

function tick() {
	timer = null;
	if (!sim || !running) return;
	try {
		runTick();
	} catch (error) {
		reportEngineError('run', error);
	}
}

function runTick() {
	runBudgeted(speedBudget());
	flushWarnings();

	if (sim.halted || sim.isSettled) {
		// A settled circuit needs no more ticks until the user touches
		// something; `input` restarts the loop. This is not a stall.
		running = false;
		requestFrame();
		return;
	}
	requestFrame();
	scheduleTick();
}

function load(nextCircuit) {
	stopTimer();
	clearFrameTimer();
	resetWarningThrottle();
	running = false;
	lastFrameAt = -Infinity;
	// Dropped BEFORE constructing, so a throw part-way through leaves no
	// simulation rather than the previous one — otherwise a failed load leaves
	// the worker quietly serving frames from a circuit the user has replaced.
	sim = null;
	// Replaces the whole simulation object. Nothing from the previous load is
	// carried over, so repeated loads cannot accumulate nets, drivers or events.
	const next = new Simulation(nextCircuit);
	next.settle();
	sim = next;
	// Only remembered once the load succeeded, so `reset` cannot replay a
	// circuit that could not be built.
	circuit = nextCircuit;

	const warnings = sim.drainWarnings();
	post({
		type: 'loaded',
		nets: sim.netCount,
		warnings,
		netIndex: sim.netIndex(),
	});
	requestFrame(true);
}

self.onmessage = (event) => {
	const message = event.data;
	if (!message || typeof message.type !== 'string') return;
	try {
		handleMessage(message);
	} catch (error) {
		reportEngineError(message.type, error);
	}
};

function handleMessage(message) {
	switch (message.type) {
		case 'load':
			load(message.circuit);
			break;

		case 'run':
			if (!sim) break;
			// resume() refuses while the supply is still shorted; honour that
			// rather than pretending to run.
			if (sim.halted && !sim.resume()) {
				requestFrame();
				break;
			}
			running = true;
			scheduleTick();
			break;

		case 'pause':
			running = false;
			stopTimer();
			requestFrame();
			break;

		case 'step': {
			if (!sim) break;
			// Stepping clears a halt so the user can single-step into a
			// non-converging loop and look at it, but the guard is still armed:
			// the step itself terminates rather than spinning.
			if (sim.halted) sim.resume();
			running = false;
			stopTimer();
			const count = Number.isFinite(message.count) && message.count > 0 ? Math.floor(message.count) : 1;
			sim.runEvents(count);
			flushWarnings();
			requestFrame();
			break;
		}

		case 'setSpeed': {
			const rate = Number(message.eventsPerSecond);
			if (Number.isFinite(rate) && rate > 0) eventsPerSecond = rate;
			break;
		}

		case 'input': {
			if (!sim) break;
			sim.applyInput(message.uid, message.value);
			if (sim.halted) sim.resume();
			if (!running) {
				// Settle the consequences of the interaction even while paused,
				// otherwise a button press appears to do nothing.
				runBudgeted(speedBudget());
				if (!sim.isSettled && !sim.halted) {
					running = true;
					scheduleTick();
				}
			}
			flushWarnings();
			requestFrame();
			break;
		}

		case 'reset':
			if (circuit) load(circuit);
			break;

		default:
			break;
	}
}
