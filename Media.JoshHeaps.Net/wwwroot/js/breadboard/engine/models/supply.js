/**
 * 5 V power supply. Two pins: pin 1 (v+) onto a plus rail, pin 2 (gnd) onto the
 * matching minus rail.
 *
 * Drives at STRENGTH_SUPPLY rather than STRENGTH_STRONG. A rail is not just a
 * strong output — it wins against one, and two supply drivers of opposite
 * polarity meeting on one net is a short circuit rather than ordinary
 * contention. Keeping supply as its own strength is what lets net-state tell
 * those two faults apart.
 */

import { STRENGTH_SUPPLY, VALUE_HIGH, VALUE_LOW } from '../constants.js';
import { defineModel } from './registry.js';

const PIN_PLUS = 0;
const PIN_GND = 1;

defineModel({
	type: 'powerSupply5V',
	pinCount: 2,
	delayNs: 0,

	init(ctx, inst) {
		if (inst.pins[PIN_PLUS] < 0 || inst.pins[PIN_GND] < 0) {
			ctx.staticWarning('unconnectedSupply', `power supply ${inst.uid} is not attached to a rail pair`, [inst.uid]);
			return;
		}
		ctx.driveNow(inst, PIN_PLUS, STRENGTH_SUPPLY, VALUE_HIGH);
		ctx.driveNow(inst, PIN_GND, STRENGTH_SUPPLY, VALUE_LOW);
	},

	// A supply is not sensitive to anything: it holds its rails regardless of
	// what else lands on them, which is exactly how a short circuit becomes
	// visible instead of being resolved away.
	evaluate() {},
});
