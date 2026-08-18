/**
 * Diode. Pin 1 is the anode, pin 2 the banded cathode.
 *
 * A one-way conductor: forward biased it passes the anode's drive through to
 * the cathode at full strength (conduction.js), reverse biased it passes
 * nothing, and it NEVER drives its anode in either state. That asymmetry is the
 * whole part — it is what makes diode-OR steering, polarity protection and a
 * freewheel path across an inductive load behave differently from a wire.
 *
 * Forward bias is decided from the cathode read EXCLUDING this diode's own
 * contribution, for the same reason the transistors do it: a diode charging an
 * otherwise-floating node would otherwise see the node it had just pulled high,
 * conclude it was no longer forward biased, release, and oscillate.
 *
 * The cathode is treated as blocking whenever it is ALREADY high — not only
 * when it is driven high by something stronger. Two supplies steered into one
 * node through a diode each is the ordinary case, and neither diode should
 * report conducting into the other's output.
 *
 * LIMIT OF THIS MODEL. There is no forward voltage drop, because there is no
 * voltage between 0 V and 5 V to drop it to (see resistor.js). A diode here is
 * a switch that only closes one way; a chain of them does not stack up 0.7 V a
 * time, and a diode cannot be used as a voltage reference. Reverse breakdown is
 * not modelled either, so a Zener cannot be built from one. Forward voltage
 * DOES matter for an LED, and lives in the LED's own model.
 */

import { LEVEL_HIGH, LEVEL_WEAK_HIGH } from '../constants.js';
import { defineModel } from './registry.js';
import { conduct } from './conduction.js';

/** Loop breaker, as everywhere else conduction is instantaneous in reality. */
const DIODE_DELAY_NS = 1;

const PIN_ANODE = 0;
const PIN_CATHODE = 1;

function isHigh(level) {
	return level === LEVEL_HIGH || level === LEVEL_WEAK_HIGH;
}

function refreshBias(ctx, inst) {
	// The anode needs no exclusion: a diode never drives its own anode, so its
	// driver there is high-Z and contributes nothing to exclude.
	const forward = isHigh(ctx.level(inst, PIN_ANODE)) && !isHigh(ctx.levelExcludingSelf(inst, PIN_CATHODE));
	conduct(ctx, inst, PIN_ANODE, PIN_CATHODE, forward, DIODE_DELAY_NS);
}

defineModel({
	type: 'diode',
	pinCount: 2,
	delayNs: DIODE_DELAY_NS,
	functionalPins: [[1, 2]],

	init(ctx, inst) {
		refreshBias(ctx, inst);
	},

	evaluate(ctx, inst) {
		refreshBias(ctx, inst);
	},
});
