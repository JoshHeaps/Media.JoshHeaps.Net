/**
 * 74HC combinational logic ICs, 14-pin DIP.
 *
 * PINOUTS ARE THE WHOLE POINT OF THIS FILE — a wrong one is invisible in a
 * passing test suite and poisons every circuit built on it. Pin numbers below
 * are 1-based, exactly as printed on a datasheet, and are converted to 0-based
 * indexes at registration. Two that catch people out:
 *
 *   - 74HC02 is NOT the '00 layout. The NOR gate's OUTPUT comes first:
 *     pin 1 is 1Y, not 1A. Cloning the '00 table here yields a chip that looks
 *     right and behaves wrong.
 *   - 74HC30's eight inputs are NOT pins 1-8. Pins 9, 10 and 13 are no-connects
 *     and inputs G and H live on 11 and 12.
 *
 * '00, '08, '32 and '86 really do share one layout
 * (1A 1B 1Y 2A 2B 2Y GND 3Y 3A 3B 4Y 4A 4B VCC), so that table is written once.
 *
 * Propagation delays are typical tPD at 5 V, 25 C from the NXP/TI 74HC data
 * sheets, rounded to whole ns.
 */

import {
	INPUT_UNKNOWN,
	LEVEL_TO_INPUT,
	LEVEL_HIGH,
	LEVEL_WEAK_HIGH,
	LEVEL_LOW,
	LEVEL_WEAK_LOW,
	STRENGTH_STRONG,
	STRENGTH_HIGHZ,
	VALUE_HIGH,
	VALUE_LOW,
} from '../constants.js';
import { defineModel, WAKE_PIN } from './registry.js';
import { applyOp, OP_AND, OP_NAND, OP_OR, OP_NOR, OP_XOR, OP_NOT } from './logic.js';

/** Quad 2-input gate layout shared by 74HC00, '08, '32 and '86. */
const QUAD_2IN_PINS = [
	{ out: 3, ins: [1, 2] },
	{ out: 6, ins: [4, 5] },
	{ out: 8, ins: [9, 10] },
	{ out: 11, ins: [12, 13] },
];

/** 74HC02 quad 2-input NOR — outputs first. */
const QUAD_NOR_PINS = [
	{ out: 1, ins: [2, 3] },
	{ out: 4, ins: [5, 6] },
	{ out: 10, ins: [8, 9] },
	{ out: 13, ins: [11, 12] },
];

/** 74HC04 hex inverter. */
const HEX_INV_PINS = [
	{ out: 2, ins: [1] },
	{ out: 4, ins: [3] },
	{ out: 6, ins: [5] },
	{ out: 8, ins: [9] },
	{ out: 10, ins: [11] },
	{ out: 12, ins: [13] },
];

/** 74HC30 single 8-input NAND. Pins 9, 10 and 13 are no-connects. */
const NAND8_PINS = [{ out: 8, ins: [1, 2, 3, 4, 5, 6, 11, 12] }];

const IC_TABLE = [
	{ type: '74HC00', op: OP_NAND, gates: QUAD_2IN_PINS, delayNs: 9 },
	{ type: '74HC02', op: OP_NOR, gates: QUAD_NOR_PINS, delayNs: 9 },
	{ type: '74HC04', op: OP_NOT, gates: HEX_INV_PINS, delayNs: 8 },
	{ type: '74HC08', op: OP_AND, gates: QUAD_2IN_PINS, delayNs: 9 },
	{ type: '74HC32', op: OP_OR, gates: QUAD_2IN_PINS, delayNs: 9 },
	{ type: '74HC86', op: OP_XOR, gates: QUAD_2IN_PINS, delayNs: 12 },
	{ type: '74HC30', op: OP_NAND, gates: NAND8_PINS, delayNs: 12 },
];

const VCC_PIN = 14;
const GND_PIN = 7;
const PIN_COUNT = 14;
const NO_GATE = 255;

/** Scratch buffer for gate inputs. Single-threaded worker, so one is enough. */
const inputScratch = new Uint8Array(8);

function isPowered(ctx, inst) {
	const vcc = ctx.level(inst, inst.model.vccIndex);
	const gnd = ctx.level(inst, inst.model.gndIndex);
	return (vcc === LEVEL_HIGH || vcc === LEVEL_WEAK_HIGH) && (gnd === LEVEL_LOW || gnd === LEVEL_WEAK_LOW);
}

function evaluateGate(ctx, inst, gateIndex, powered) {
	const gate = inst.model.gateList[gateIndex];
	if (!powered) {
		// An unpowered chip drives nothing. Its outputs are high-Z, not low.
		ctx.drive(inst, gate.out, STRENGTH_HIGHZ, VALUE_LOW, inst.delayNs);
		return;
	}
	const ins = gate.ins;
	for (let i = 0; i < ins.length; i++) inputScratch[i] = LEVEL_TO_INPUT[ctx.level(inst, ins[i])];
	const result = applyOp(inst.model.op, inputScratch, ins.length);
	if (result === INPUT_UNKNOWN) {
		// Indeterminate output: release the pin rather than invent a level, so
		// the unknown keeps propagating instead of being laundered into a 0.
		ctx.drive(inst, gate.out, STRENGTH_HIGHZ, VALUE_LOW, inst.delayNs);
		return;
	}
	ctx.drive(inst, gate.out, STRENGTH_STRONG, result === 1 ? VALUE_HIGH : VALUE_LOW, inst.delayNs);
}

function evaluateAll(ctx, inst) {
	const powered = isPowered(ctx, inst);
	const gates = inst.model.gateList;
	for (let g = 0; g < gates.length; g++) evaluateGate(ctx, inst, g, powered);
}

for (const entry of IC_TABLE) {
	const gateList = entry.gates.map((gate) => ({
		out: gate.out - 1,
		ins: gate.ins.map((p) => p - 1),
	}));

	// pin -> the one gate it feeds, for O(1) wake dispatch.
	const gateOfPin = new Uint8Array(PIN_COUNT).fill(NO_GATE);
	for (let g = 0; g < gateList.length; g++) {
		for (const pin of gateList[g].ins) gateOfPin[pin] = g;
	}

	defineModel({
		type: entry.type,
		pinCount: PIN_COUNT,
		delayNs: entry.delayNs,
		vcc: VCC_PIN,
		gnd: GND_PIN,
		vccIndex: VCC_PIN - 1,
		gndIndex: GND_PIN - 1,
		op: entry.op,
		gateList,
		gateOfPin,
		outputPins: gateList.map((g) => g.out),
		inputPins: gateList.flatMap((g) => g.ins),

		init(ctx, inst) {
			if (!isPowered(ctx, inst)) {
				ctx.staticWarning(
					'unpoweredChip',
					`${inst.type} ${inst.uid}: pin ${VCC_PIN} (VCC) / pin ${GND_PIN} (GND) are not tied to 5V and ground`,
					[inst.uid],
				);
			}
			// An input is floating when nothing else in the circuit shares its
			// net: no wire, no other pin, so nothing can ever drive it. That is
			// different from an input that simply has not been driven yet at
			// load time, which is normal and must not warn.
			for (const gate of inst.model.gateList) {
				for (const pin of gate.ins) {
					if (inst.pins[pin] < 0 || ctx.netListenerCount(inst.pins[pin]) <= 1) {
						ctx.staticWarning('floatingInput', `${inst.type} ${inst.uid}: pin ${pin + 1} is not connected to anything`, [
							inst.uid,
						]);
					}
				}
			}
		},

		evaluate(ctx, inst, wake) {
			// Anything that is not a pin change — init, a self-scheduled timer,
			// or any wake reason added later — re-evaluates the whole chip.
			// Testing `=== WAKE_INIT` instead left WAKE_TIMER falling through to
			// the pin path with wake.pin === -1, where gateOfPin[-1] is
			// `undefined`, `undefined === NO_GATE` is false, and gateList
			// [undefined].ins throws. ctx.scheduleSelf is a public API, so that
			// was reachable by any model author following the registry docs.
			if (wake.reason !== WAKE_PIN) {
				evaluateAll(ctx, inst);
				return;
			}
			const pin = wake.pin;
			if (pin === inst.model.vccIndex || pin === inst.model.gndIndex) {
				evaluateAll(ctx, inst);
				return;
			}
			const gate = inst.model.gateOfPin[pin];
			if (!(gate >= 0) || gate === NO_GATE) return;
			evaluateGate(ctx, inst, gate, isPowered(ctx, inst));
		},
	});
}
