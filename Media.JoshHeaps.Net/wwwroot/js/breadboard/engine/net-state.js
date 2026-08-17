/**
 * Net state: the driver table and per-net signal resolution.
 *
 * MUTABLE HOT PATH. Everything here is typed arrays updated in place. Callers
 * must go through the methods; nothing outside this file may touch the buffers.
 *
 * Resolution is O(1) per driver change, never a sweep. Instead of re-folding a
 * net's driver list, each net carries six counters — one per (strength, value)
 * pair for the three real strengths — and a driver change decrements one
 * counter and increments another. Reading the winner is then a fixed sequence
 * of integer tests. This is exactly equivalent to the pure fold in drive.js
 * (`foldDrives`): the counters ARE the value-mask union, tallied. drive.spec
 * cross-checks the two implementations against each other over random
 * permutations.
 */

import {
	LEVEL_LOW,
	LEVEL_HIGH,
	LEVEL_HIGHZ,
	LEVEL_WEAK_LOW,
	LEVEL_WEAK_HIGH,
	LEVEL_CONTENTION,
	STRENGTH_HIGHZ,
	STRENGTH_WEAK,
	STRENGTH_STRONG,
	STRENGTH_SUPPLY,
} from './constants.js';
import {
	FAULT_NONE,
	FAULT_CONTENTION,
	FAULT_SHORT_CIRCUIT,
	DRIVE_HIGHZ,
	MASK_LOW,
	MASK_HIGH,
	driveToLevel,
} from './drive.js';

const COUNTERS_PER_NET = 6;

export class NetState {
	/**
	 * @param {number} netCount
	 * @param {number} driverCapacity  initial driver-table size; grows by doubling
	 */
	constructor(netCount, driverCapacity = 64) {
		this.netCount = netCount;
		/** Counters: net*6 + (strength-1)*2 + value. */
		this.counts = new Int32Array(netCount * COUNTERS_PER_NET);
		/** Wire-format level code per net. Handed to the UI verbatim. */
		this.levels = new Uint8Array(netCount).fill(LEVEL_HIGHZ);
		/** Fault classification per net (FAULT_* from drive.js). */
		this.faults = new Uint8Array(netCount);

		this.driverCount = 0;
		this.driverNet = new Int32Array(driverCapacity);
		this.driverStrength = new Uint8Array(driverCapacity);
		this.driverValue = new Uint8Array(driverCapacity);
	}

	/** Registers a new driver on `netId`, initially high-Z. Returns its id. */
	addDriver(netId) {
		const id = this.driverCount++;
		if (id >= this.driverNet.length) this.#growDrivers();
		this.driverNet[id] = netId;
		this.driverStrength[id] = STRENGTH_HIGHZ;
		this.driverValue[id] = 0;
		return id;
	}

	#growDrivers() {
		const capacity = this.driverNet.length * 2;
		const net = new Int32Array(capacity);
		net.set(this.driverNet);
		const strength = new Uint8Array(capacity);
		strength.set(this.driverStrength);
		const value = new Uint8Array(capacity);
		value.set(this.driverValue);
		this.driverNet = net;
		this.driverStrength = strength;
		this.driverValue = value;
	}

	/**
	 * Applies a driver change.
	 * @returns {boolean} true when the net's resolved level actually moved —
	 *   the scheduler only propagates on a real change, so redundant drives
	 *   cost two counter updates and stop there.
	 */
	setDriver(driverId, strength, value) {
		const oldStrength = this.driverStrength[driverId];
		const oldValue = this.driverValue[driverId];
		if (oldStrength === strength && (strength === STRENGTH_HIGHZ || oldValue === value)) return false;

		const netId = this.driverNet[driverId];
		if (netId < 0) {
			this.driverStrength[driverId] = strength;
			this.driverValue[driverId] = value;
			return false;
		}

		const base = netId * COUNTERS_PER_NET;
		const counts = this.counts;
		if (oldStrength !== STRENGTH_HIGHZ) counts[base + (oldStrength - 1) * 2 + oldValue]--;
		if (strength !== STRENGTH_HIGHZ) counts[base + (strength - 1) * 2 + value]++;
		this.driverStrength[driverId] = strength;
		this.driverValue[driverId] = value;

		return this.refresh(netId);
	}

	/** Recomputes one net's level and fault. Returns true if the level changed. */
	refresh(netId) {
		const base = netId * COUNTERS_PER_NET;
		const counts = this.counts;

		const supplyLow = counts[base + 4] !== 0;
		const supplyHigh = counts[base + 5] !== 0;
		const strongLow = counts[base + 2] !== 0;
		const strongHigh = counts[base + 3] !== 0;

		let level;
		let fault = FAULT_NONE;

		if (supplyLow || supplyHigh) {
			if (supplyLow && supplyHigh) {
				// Rail+ tied to rail-.
				level = LEVEL_CONTENTION;
				fault = FAULT_SHORT_CIRCUIT;
			} else if (supplyHigh) {
				level = LEVEL_HIGH;
				// A chip output pulling against the rail is still a fight.
				if (strongLow) fault = FAULT_CONTENTION;
			} else {
				level = LEVEL_LOW;
				if (strongHigh) fault = FAULT_CONTENTION;
			}
		} else if (strongLow || strongHigh) {
			if (strongLow && strongHigh) {
				level = LEVEL_CONTENTION;
				fault = FAULT_CONTENTION;
			} else {
				level = strongHigh ? LEVEL_HIGH : LEVEL_LOW;
			}
		} else {
			const weakLow = counts[base] !== 0;
			const weakHigh = counts[base + 1] !== 0;
			if (weakLow && weakHigh) {
				// Pull-up versus pull-down. Indeterminate as a logic level, but a
				// resistor divider is not a fault, so no warning is raised.
				level = LEVEL_CONTENTION;
			} else if (weakHigh) {
				level = LEVEL_WEAK_HIGH;
			} else if (weakLow) {
				level = LEVEL_WEAK_LOW;
			} else {
				level = LEVEL_HIGHZ;
			}
		}

		this.faults[netId] = fault;
		if (this.levels[netId] === level) return false;
		this.levels[netId] = level;
		return true;
	}

	levelOf(netId) {
		return netId < 0 ? LEVEL_HIGHZ : this.levels[netId];
	}

	faultOf(netId) {
		return netId < 0 ? FAULT_NONE : this.faults[netId];
	}

	/**
	 * Resolves a net as it would be WITHOUT one particular driver's
	 * contribution, returning a packed drive (see drive.js) so the caller keeps
	 * the STRENGTH, not just the level.
	 *
	 * Bidirectional elements need this. A closed switch contact must pass what
	 * the other side sees, and if it counted its own output it would latch onto
	 * its own value forever. Strength has to survive the trip too: a button
	 * bridging the two rails has to pass SUPPLY strength through, or the far
	 * rail sees a merely-strong driver and the short reads as ordinary
	 * contention instead of a short circuit.
	 *
	 * Temporarily decrements the driver's own counter rather than copying the
	 * net — hot path, and the mutation is restored before returning.
	 */
	driveExcluding(netId, driverId) {
		if (netId < 0) return DRIVE_HIGHZ;
		const strength = this.driverStrength[driverId];
		const base = netId * COUNTERS_PER_NET;
		if (strength === STRENGTH_HIGHZ) return this.#peek(base);

		const counts = this.counts;
		const slot = base + (strength - 1) * 2 + this.driverValue[driverId];
		counts[slot]--;
		const drive = this.#peek(base);
		counts[slot]++;
		return drive;
	}

	levelExcluding(netId, driverId) {
		return driveToLevel(this.driveExcluding(netId, driverId));
	}

	/** Folded drive on a net, as a packed (strength, valueMask) pair. */
	#peek(base) {
		const counts = this.counts;
		let mask = (counts[base + 4] !== 0 ? MASK_LOW : 0) | (counts[base + 5] !== 0 ? MASK_HIGH : 0);
		if (mask !== 0) return STRENGTH_SUPPLY * 4 + mask;
		mask = (counts[base + 2] !== 0 ? MASK_LOW : 0) | (counts[base + 3] !== 0 ? MASK_HIGH : 0);
		if (mask !== 0) return STRENGTH_STRONG * 4 + mask;
		mask = (counts[base] !== 0 ? MASK_LOW : 0) | (counts[base + 1] !== 0 ? MASK_HIGH : 0);
		if (mask !== 0) return STRENGTH_WEAK * 4 + mask;
		return DRIVE_HIGHZ;
	}
}

export { FAULT_NONE, FAULT_CONTENTION, FAULT_SHORT_CIRCUIT };
