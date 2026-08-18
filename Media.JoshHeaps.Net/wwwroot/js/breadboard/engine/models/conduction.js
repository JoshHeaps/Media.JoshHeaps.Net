/**
 * Bidirectional conduction between two pins of one component.
 *
 * Shared by every element that opens and closes a channel: mechanical contacts
 * (push button, DIP switch) and the transistors. Conduction is NOT a dynamic
 * merge of the two nets — re-running union-find every time a contact moves
 * would be slow, and it would invalidate the net index the UI is handed once at
 * load. Each side simply drives the other with what it sees.
 *
 * Conduction preserves STRENGTH, unlike a resistor: a closed contact between
 * the two power rails has to hand SUPPLY strength across so the short reads as
 * a short circuit and not as garden-variety contention. The same is true of a
 * saturated transistor, which is why it destroys itself in real life.
 *
 * The source net is always read EXCLUDING the element's own contribution to it,
 * or a closed channel would read back the value it is itself asserting and
 * latch onto it forever after the real source went away.
 *
 * Every caller passes a non-zero delay. It is a loop breaker rather than a
 * physical figure: two elements wired in a ring would otherwise conduct round
 * it at zero delay forever and trip the delta-cycle guard.
 */

import { STRENGTH_HIGHZ, VALUE_LOW } from '../constants.js';
import { driveStrength, driveMask, MASK_LOW, MASK_HIGH } from '../drive.js';

/** Passes `fromPin`'s net through to `toPin` at full strength, or opens the channel. */
export function conduct(ctx, inst, fromPin, toPin, closed, delayNs) {
	if (!closed) {
		ctx.drive(inst, toPin, STRENGTH_HIGHZ, VALUE_LOW, delayNs);
		return;
	}
	const drive = ctx.driveExcludingSelf(inst, fromPin);
	const strength = driveStrength(drive);
	const mask = driveMask(drive);
	// A source that is itself unresolved (both polarities present) passes
	// nothing: there is no single value to conduct.
	if (strength === STRENGTH_HIGHZ || (mask !== MASK_LOW && mask !== MASK_HIGH)) {
		ctx.drive(inst, toPin, STRENGTH_HIGHZ, VALUE_LOW, delayNs);
		return;
	}
	ctx.drive(inst, toPin, strength, mask === MASK_HIGH ? 1 : 0, delayNs);
}

/** Refreshes both directions of the bridge between `a` and `b`. */
export function refreshBridge(ctx, inst, a, b, closed, delayNs) {
	conduct(ctx, inst, a, b, closed, delayNs);
	conduct(ctx, inst, b, a, closed, delayNs);
}
