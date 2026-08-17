/**
 * LED. Pin 1 is the anode, pin 2 the cathode.
 *
 * An LED is a load, not a driver: it presents high-Z on both pins and never
 * asserts a level. What it does is compute forward current so the UI can show
 * brightness, and so overcurrent and burnout can be reported.
 *
 *     I = (Vanode - Vcathode - Vf) / Rseries
 *
 * Rseries is the dominant current-limiting resistor on each side plus the LED's
 * own bulk resistance. "Dominant" means the smallest resistor touching that
 * net, which is the right answer for the normal one-resistor-per-side case and
 * a sane approximation otherwise — a full nodal solve is out of scope for a
 * logic simulator.
 *
 * The bulk resistance is what makes a resistor-less LED behave the way it does
 * in real life: 5 V straight across a red LED computes ~320 mA and burns it
 * out, which is exactly the mistake a beginner makes on a real breadboard and
 * exactly what this simulator exists to show them.
 *
 * Burnout latches. A burned LED conducts nothing and stays burned until the
 * circuit is reloaded or explicitly reset — the spec calls for a persistent
 * flag, not a transient warning.
 */

import {
	LEVEL_VOLTAGE,
	LED_FORWARD_VOLTAGE,
	DEFAULT_LED_FORWARD_VOLTAGE,
	LED_INTRINSIC_OHMS,
	LED_WARN_CURRENT,
	LED_BURNOUT_CURRENT,
} from '../constants.js';
import { defineModel } from './registry.js';

const PIN_ANODE = 0;
const PIN_CATHODE = 1;

function forwardVoltageOf(component) {
	const colour = String(component?.props?.color ?? 'red').toLowerCase();
	return LED_FORWARD_VOLTAGE[colour] ?? DEFAULT_LED_FORWARD_VOLTAGE;
}

/**
 * Forward current in amps, or 0 when the LED is off, reverse-biased, burned, or
 * sitting on a net whose level is indeterminate. Pure — exported so the current
 * maths can be tested without standing up a whole simulation.
 */
export function ledCurrent(anodeLevel, cathodeLevel, forwardVoltage, seriesOhms) {
	const vAnode = LEVEL_VOLTAGE[anodeLevel];
	const vCathode = LEVEL_VOLTAGE[cathodeLevel];
	if (Number.isNaN(vAnode) || Number.isNaN(vCathode)) return 0;
	const across = vAnode - vCathode - forwardVoltage;
	if (across <= 0) return 0;
	return across / seriesOhms;
}

defineModel({
	type: 'led',
	pinCount: 2,
	delayNs: 0,
	functionalPins: [[1, 2]],

	createState(component) {
		return {
			forwardVoltage: forwardVoltageOf(component),
			seriesOhms: LED_INTRINSIC_OHMS,
			current: 0,
			burned: false,
			warnedOvercurrent: false,
		};
	},

	init(ctx, inst) {
		const anodeSide = ctx.dominantSeriesOhms(inst.pins[PIN_ANODE]);
		const cathodeSide = ctx.dominantSeriesOhms(inst.pins[PIN_CATHODE]);
		inst.state.seriesOhms = anodeSide + cathodeSide + LED_INTRINSIC_OHMS;
		this.evaluate(ctx, inst, { reason: 0, pin: -1 });
	},

	evaluate(ctx, inst) {
		const state = inst.state;
		if (state.burned) {
			ctx.setLedCurrent(inst, 0);
			return;
		}
		const current = ledCurrent(
			ctx.level(inst, PIN_ANODE),
			ctx.level(inst, PIN_CATHODE),
			state.forwardVoltage,
			state.seriesOhms,
		);
		if (current === state.current) return;
		state.current = current;

		if (current > LED_BURNOUT_CURRENT) {
			state.burned = true;
			state.current = 0;
			ctx.setLedCurrent(inst, 0);
			ctx.warn(
				'ledBurnout',
				[inst.uid],
				inst.pins[PIN_ANODE],
				`LED ${inst.uid} drew ${(current * 1000).toFixed(0)} mA through ${state.seriesOhms.toFixed(0)} ohms and burned out`,
			);
			return;
		}

		ctx.setLedCurrent(inst, current);

		if (current > LED_WARN_CURRENT && !state.warnedOvercurrent) {
			// Latched for the lifetime of this load, NOT reset when the current
			// falls back. An earlier version cleared the latch on every falling
			// edge, which sounds like "one warning per excursion" but means a
			// blinking LED re-warns on every single cycle — hundreds of
			// thousands of messages a second on a running oscillator. Being
			// over-current once is the fact worth reporting; the user does not
			// need telling again on the next blink.
			state.warnedOvercurrent = true;
			ctx.warn(
				'ledOvercurrent',
				[inst.uid],
				inst.pins[PIN_ANODE],
				`LED ${inst.uid} is drawing ${(current * 1000).toFixed(1)} mA (over ${LED_WARN_CURRENT * 1000} mA)`,
			);
		}
	},
});

export const LED_TYPE = 'led';
