/**
 * Multi-strength signal resolution — the reference (pure) implementation.
 *
 * A net's state is the fold of every driver attached to it. For that fold to be
 * well defined the combine operator MUST be commutative and associative, so the
 * answer cannot depend on driver order. It is NOT possible to get that by
 * folding over the six wire-format level codes directly:
 *
 *     (weakLow . weakHigh) . strongHigh   vs   weakLow . (weakHigh . strongHigh)
 *
 * If "weakLow . weakHigh" collapsed to `contention` and contention were
 * absorbing, the left side would be `contention` while the right side is
 * `strongHigh` — and the right side is the physically correct answer, because a
 * strong driver really does overpower a pull-up/pull-down pair. Contention is
 * therefore NOT absorbing across strengths.
 *
 * The fix is to fold in a richer domain and project to a level code only at the
 * end. A drive is a pair (strength, valueMask) where valueMask is a bitset over
 * {0,1}. Combining takes the stronger drive, or unions the value masks when the
 * strengths tie. That is a lexicographic semilattice: commutative, associative,
 * idempotent, with high-Z as the identity element.
 *
 * A drive is packed into one small integer so the whole fold is branch-light and
 * allocation-free:  packed = strength * 4 + valueMask.
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
	VALUE_LOW,
	VALUE_HIGH,
} from './constants.js';

export const MASK_NONE = 0;
export const MASK_LOW = 1;
export const MASK_HIGH = 2;
export const MASK_BOTH = 3;

/** The identity element of the fold: drives nothing. */
export const DRIVE_HIGHZ = STRENGTH_HIGHZ * 4 + MASK_NONE;

/** Packs a (strength, value) pair into a drive. */
export function makeDrive(strength, value) {
	if (strength === STRENGTH_HIGHZ) return DRIVE_HIGHZ;
	return strength * 4 + (value === VALUE_HIGH ? MASK_HIGH : MASK_LOW);
}

export function driveStrength(drive) {
	return drive >> 2;
}

export function driveMask(drive) {
	return drive & 3;
}

/**
 * The monoid operator. Commutative, associative, idempotent; DRIVE_HIGHZ is the
 * identity. Pure.
 */
export function combineDrive(a, b) {
	const sa = a >> 2;
	const sb = b >> 2;
	if (sa > sb) return a;
	if (sb > sa) return b;
	return sa * 4 + ((a & 3) | (b & 3));
}

/** Folds a list of packed drives. Pure; order-independent by construction. */
export function foldDrives(drives) {
	let acc = DRIVE_HIGHZ;
	for (let i = 0; i < drives.length; i++) acc = combineDrive(acc, drives[i]);
	return acc;
}

/**
 * Projects a folded drive onto the six wire-format level codes.
 *
 * Decisions the spec left open, pinned here:
 *   - strong beats an opposing weak outright, and raises no warning: that is
 *     just a pull-up being overdriven, the single most common breadboard idiom.
 *   - a pull-up fighting a pull-down (weakLow + weakHigh, no stronger driver)
 *     yields LEVEL_CONTENTION as a level, but raises NO contention warning —
 *     the spec scopes that warning to conflicting *strong* drivers, and a
 *     resistor divider is not a fault. See `driveFault` below.
 *   - high-Z is the identity: high-Z combined with anything is that thing.
 */
export function driveToLevel(drive) {
	const strength = drive >> 2;
	const mask = drive & 3;
	if (strength === STRENGTH_HIGHZ || mask === MASK_NONE) return LEVEL_HIGHZ;
	if (mask === MASK_BOTH) return LEVEL_CONTENTION;
	if (strength === STRENGTH_WEAK) return mask === MASK_HIGH ? LEVEL_WEAK_HIGH : LEVEL_WEAK_LOW;
	return mask === MASK_HIGH ? LEVEL_HIGH : LEVEL_LOW;
}

export const FAULT_NONE = 0;
export const FAULT_CONTENTION = 1;
export const FAULT_SHORT_CIRCUIT = 2;

/**
 * Classifies a folded drive as a fault, given whether any strong driver of the
 * losing polarity is also present.
 *
 * - two supply drivers of opposite polarity on one net is rail+ tied to rail-:
 *   a short circuit, which pauses the sim.
 * - two strong drivers of opposite polarity is ordinary output contention.
 * - a chip output fighting a supply rail is also contention: supply wins the
 *   level, but the chip is still sinking or sourcing into a rail.
 */
export function driveFault(drive, opposingStrongPresent) {
	const strength = drive >> 2;
	const mask = drive & 3;
	if (mask === MASK_BOTH) {
		return strength === STRENGTH_SUPPLY ? FAULT_SHORT_CIRCUIT : strength === STRENGTH_WEAK ? FAULT_NONE : FAULT_CONTENTION;
	}
	if (strength === STRENGTH_SUPPLY && opposingStrongPresent) return FAULT_CONTENTION;
	return FAULT_NONE;
}

export { STRENGTH_HIGHZ, STRENGTH_WEAK, STRENGTH_STRONG, STRENGTH_SUPPLY, VALUE_LOW, VALUE_HIGH };
