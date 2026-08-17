/**
 * Resistor — a bidirectional weak pass element.
 *
 * A resistor is not unioned into its neighbours' nets at load, because then a
 * pull-up would be indistinguishable from a wire. Instead each end drives the
 * other end WEAKLY with whatever it sees. That single rule covers all three
 * ways resistors get used on a breadboard:
 *
 *   - pull-up / pull-down: rail at 5 V on one side, weak high on the other,
 *     which any real chip output overrides without a fight and without a
 *     contention warning.
 *   - LED current limiting: the LED model reads `ohms` when it works out its
 *     series resistance.
 *   - net-to-net series link: signal passes, attenuated to weak.
 *
 * Each side resolves the level of its own net EXCLUDING this resistor's own
 * contribution to it. Without that exclusion the resistor would read back its
 * own output and hold a value forever after the source went away.
 *
 * The 1 ns delay is not a real RC time constant, it exists so that two
 * resistors facing each other cannot form a zero-delay loop and trip the
 * delta-cycle guard.
 *
 * LIMIT OF THIS MODEL, and it is a hard one. There is NO representation of any
 * voltage between 0 V and 5 V. Two resistors in series from rail to ground put
 * their midpoint at weakLow + weakHigh, which resolves to LEVEL_CONTENTION and
 * is read by chip inputs as INPUT_UNKNOWN — not 2.5 V. For digital logic that
 * is the honest answer, since a divider midpoint IS an invalid logic level. But
 * anything needing real node voltages — NE555 RC timing above all, and any
 * analogue behaviour generally — cannot be built on this. That is a nodal
 * solver, a genuinely different engine, NOT an extension of the weak-pass rule.
 * Budget for it as new work rather than discovering it during milestone 2.
 */

import { LEVEL_HIGH, LEVEL_WEAK_HIGH, LEVEL_LOW, LEVEL_WEAK_LOW, STRENGTH_WEAK, STRENGTH_HIGHZ, VALUE_HIGH, VALUE_LOW } from '../constants.js';
import { defineModel, WAKE_PIN } from './registry.js';

const RESISTOR_DELAY_NS = 1;
const DEFAULT_OHMS = 330;

/** Passes one side's level to the other, attenuated to weak strength. */
function pass(ctx, inst, fromPin, toPin) {
	const level = ctx.levelExcludingSelf(inst, fromPin);
	if (level === LEVEL_HIGH || level === LEVEL_WEAK_HIGH) {
		ctx.drive(inst, toPin, STRENGTH_WEAK, VALUE_HIGH, RESISTOR_DELAY_NS);
	} else if (level === LEVEL_LOW || level === LEVEL_WEAK_LOW) {
		ctx.drive(inst, toPin, STRENGTH_WEAK, VALUE_LOW, RESISTOR_DELAY_NS);
	} else {
		// High-Z or an unresolved fight: pass nothing rather than pass a guess.
		ctx.drive(inst, toPin, STRENGTH_HIGHZ, VALUE_LOW, RESISTOR_DELAY_NS);
	}
}

defineModel({
	type: 'resistor',
	pinCount: 2,
	delayNs: RESISTOR_DELAY_NS,
	functionalPins: [[1, 2]],

	createState(component) {
		const ohms = Number(component?.props?.ohms);
		return { ohms: Number.isFinite(ohms) && ohms > 0 ? ohms : DEFAULT_OHMS };
	},

	init(ctx, inst) {
		pass(ctx, inst, 0, 1);
		pass(ctx, inst, 1, 0);
	},

	evaluate(ctx, inst, wake) {
		// A non-pin wake re-passes both directions; see the note in switches.js.
		const all = wake.reason !== WAKE_PIN;
		if (all || wake.pin === 0) pass(ctx, inst, 0, 1);
		if (all || wake.pin === 1) pass(ctx, inst, 1, 0);
	},
});

export const RESISTOR_TYPE = 'resistor';
