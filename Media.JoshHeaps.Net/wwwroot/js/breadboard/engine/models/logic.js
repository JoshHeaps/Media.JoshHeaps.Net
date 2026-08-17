/**
 * Three-valued combinational logic primitives.
 *
 * Pure. Inputs and outputs are INPUT_LOW / INPUT_HIGH / INPUT_UNKNOWN.
 *
 * Unknown is not "assume zero". A 74HC input left floating is genuinely
 * indeterminate, and quietly calling it a low produces a simulation that looks
 * plausible and lies. Instead unknown propagates, EXCEPT where a controlling
 * input settles the result on its own: a NAND with one input low outputs high
 * no matter what the other input is doing, and reporting that as unknown would
 * be its own kind of wrong.
 */

import { INPUT_LOW, INPUT_HIGH, INPUT_UNKNOWN } from '../constants.js';

export function andOf(values, count) {
	let unknown = false;
	for (let i = 0; i < count; i++) {
		const v = values[i];
		if (v === INPUT_LOW) return INPUT_LOW; // controlling value
		if (v === INPUT_UNKNOWN) unknown = true;
	}
	return unknown ? INPUT_UNKNOWN : INPUT_HIGH;
}

export function orOf(values, count) {
	let unknown = false;
	for (let i = 0; i < count; i++) {
		const v = values[i];
		if (v === INPUT_HIGH) return INPUT_HIGH; // controlling value
		if (v === INPUT_UNKNOWN) unknown = true;
	}
	return unknown ? INPUT_UNKNOWN : INPUT_LOW;
}

export function xorOf(values, count) {
	let parity = 0;
	for (let i = 0; i < count; i++) {
		const v = values[i];
		if (v === INPUT_UNKNOWN) return INPUT_UNKNOWN; // XOR has no controlling value
		parity ^= v;
	}
	return parity === 1 ? INPUT_HIGH : INPUT_LOW;
}

export function invert(value) {
	return value === INPUT_UNKNOWN ? INPUT_UNKNOWN : value === INPUT_LOW ? INPUT_HIGH : INPUT_LOW;
}

export const OP_AND = 0;
export const OP_NAND = 1;
export const OP_OR = 2;
export const OP_NOR = 3;
export const OP_XOR = 4;
export const OP_XNOR = 5;
export const OP_NOT = 6;
export const OP_BUF = 7;

export function applyOp(op, values, count) {
	switch (op) {
		case OP_AND:
			return andOf(values, count);
		case OP_NAND:
			return invert(andOf(values, count));
		case OP_OR:
			return orOf(values, count);
		case OP_NOR:
			return invert(orOf(values, count));
		case OP_XOR:
			return xorOf(values, count);
		case OP_XNOR:
			return invert(xorOf(values, count));
		case OP_NOT:
			return invert(values[0]);
		case OP_BUF:
			return values[0];
		default:
			return INPUT_UNKNOWN;
	}
}
