/**
 * Mechanical contacts: push button and 8-position DIP switch.
 *
 * A closed contact is modelled as a bidirectional conductor rather than a
 * dynamic merge of the two nets. Re-running union-find every time a user
 * presses a button would be both slow and a nightmare for the UI's net index,
 * which is handed out once at load and must stay valid.
 *
 * Conduction preserves STRENGTH, unlike a resistor: a closed button between the
 * two power rails has to hand SUPPLY strength across so the short reads as a
 * short circuit and not as garden-variety contention.
 *
 * The 1 ns contact delay is a loop breaker, not a debounce model. Two contacts
 * wired in a ring would otherwise conduct round it at zero delay forever.
 */

import { STRENGTH_HIGHZ, VALUE_LOW } from '../constants.js';
import { driveStrength, driveMask, MASK_LOW, MASK_HIGH } from '../drive.js';
import { defineModel, WAKE_PIN } from './registry.js';

const CONTACT_DELAY_NS = 1;

/**
 * Passes `fromPin`'s net through to `toPin` at full strength, or opens the
 * contact. Reads the source net excluding this element's own contribution, so
 * the contact cannot latch onto the value it is itself asserting.
 */
function conduct(ctx, inst, fromPin, toPin, closed) {
	if (!closed) {
		ctx.drive(inst, toPin, STRENGTH_HIGHZ, VALUE_LOW, CONTACT_DELAY_NS);
		return;
	}
	const drive = ctx.driveExcludingSelf(inst, fromPin);
	const strength = driveStrength(drive);
	const mask = driveMask(drive);
	// A source that is itself unresolved (both polarities present) passes
	// nothing: there is no single value to conduct.
	if (strength === STRENGTH_HIGHZ || (mask !== MASK_LOW && mask !== MASK_HIGH)) {
		ctx.drive(inst, toPin, STRENGTH_HIGHZ, VALUE_LOW, CONTACT_DELAY_NS);
		return;
	}
	ctx.drive(inst, toPin, strength, mask === MASK_HIGH ? 1 : 0, CONTACT_DELAY_NS);
}

function refreshContact(ctx, inst, a, b, closed) {
	conduct(ctx, inst, a, b, closed);
	conduct(ctx, inst, b, a, closed);
}

/* ------------------------------------------------------------------ *
 * Push button: 4 pins. Pins 1+2 are permanently tied, as are 3+4 —
 * those ties are static merges declared below and applied by the net
 * builder. Pressing connects group A to group B.
 * ------------------------------------------------------------------ */

const BUTTON_A = 0; // pin 1, representative of the permanently-tied A group
const BUTTON_B = 2; // pin 3, representative of the B group

defineModel({
	type: 'pushButton',
	pinCount: 4,
	delayNs: CONTACT_DELAY_NS,
	ties: [
		[1, 2],
		[3, 4],
	],

	createState(component) {
		return { pressed: component?.props?.pressed === true };
	},

	init(ctx, inst) {
		refreshContact(ctx, inst, BUTTON_A, BUTTON_B, inst.state.pressed);
	},

	evaluate(ctx, inst, wake) {
		if (wake.reason === WAKE_PIN && wake.pin !== BUTTON_A && wake.pin !== BUTTON_B) return;
		refreshContact(ctx, inst, BUTTON_A, BUTTON_B, inst.state.pressed);
	},

	/** `{ type:"input", uid, value }` — value is a boolean: pressed or released. */
	applyInput(ctx, inst, value) {
		const pressed = value === true || value?.pressed === true;
		if (inst.state.pressed === pressed) return;
		inst.state.pressed = pressed;
		refreshContact(ctx, inst, BUTTON_A, BUTTON_B, pressed);
	},
});

/* ------------------------------------------------------------------ *
 * 8-position DIP switch: 16 pins. Switch k (1..8) bridges package pin
 * k to package pin 17-k, i.e. straight across the centre gap.
 * ------------------------------------------------------------------ */

const DIP_SWITCH_COUNT = 8;

/** 0-based pin indexes bridged by switch `k` (1-based). */
function dipPins(k) {
	return [k - 1, 16 - k];
}

defineModel({
	type: 'dipSwitch8',
	pinCount: 16,
	delayNs: CONTACT_DELAY_NS,

	createState(component) {
		const on = new Uint8Array(DIP_SWITCH_COUNT);
		const source = component?.props?.on;
		if (Array.isArray(source)) {
			for (let i = 0; i < DIP_SWITCH_COUNT; i++) on[i] = source[i] === true ? 1 : 0;
		}
		return { on };
	},

	init(ctx, inst) {
		for (let k = 1; k <= DIP_SWITCH_COUNT; k++) {
			const [a, b] = dipPins(k);
			refreshContact(ctx, inst, a, b, inst.state.on[k - 1] === 1);
		}
	},

	evaluate(ctx, inst, wake) {
		// Any non-pin wake (init, a self-scheduled timer, anything added later)
		// refreshes every contact. Falling through to the pin path with
		// wake.pin === -1 used to compute k = 17 and drive pin -1, which the
		// old fail-open guard in drive() then aliased onto an unrelated net —
		// silently wrong output rather than a crash.
		if (wake.reason !== WAKE_PIN) {
			for (let k = 1; k <= DIP_SWITCH_COUNT; k++) {
				const [a, b] = dipPins(k);
				refreshContact(ctx, inst, a, b, inst.state.on[k - 1] === 1);
			}
			return;
		}
		// Only the one switch straddling the woken pin can be affected.
		const pin = wake.pin;
		if (!(pin >= 0) || pin > 15) return;
		const k = pin < DIP_SWITCH_COUNT ? pin + 1 : 16 - pin;
		const [a, b] = dipPins(k);
		refreshContact(ctx, inst, a, b, inst.state.on[k - 1] === 1);
	},

	/**
	 * `{ type:"input", uid, value:{ pin, on } }` where `pin` is the SWITCH
	 * number 1..8, not the 16-pin package pin number.
	 */
	applyInput(ctx, inst, value) {
		const k = Number(value?.pin);
		if (!Number.isInteger(k) || k < 1 || k > DIP_SWITCH_COUNT) return;
		const on = value.on === true ? 1 : 0;
		if (inst.state.on[k - 1] === on) return;
		inst.state.on[k - 1] = on;
		const [a, b] = dipPins(k);
		refreshContact(ctx, inst, a, b, on === 1);
	},
});
