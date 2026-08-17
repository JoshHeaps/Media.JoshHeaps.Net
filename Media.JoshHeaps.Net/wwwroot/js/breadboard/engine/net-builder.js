/**
 * Net extraction: circuit document -> electrical nets.
 *
 * Pure. Given a circuit and the model registry, returns net ids for every
 * breadboard strip and every component pin. Runs once per `load`.
 *
 * Three sources of connectivity are unioned:
 *   1. breadboard strips and rails — each is a node, supplied by
 *      shared/board-geometry.js `stripKey` (a column's rows a-e are one strip,
 *      f-j another, each rail is one strip).
 *   2. wires — union the two endpoints' strips.
 *   3. component pins — a pin adopts the net of the strip it sits in.
 *   4. permanent internal ties — pins a component shorts together and never
 *      un-shorts, e.g. the two halves of a push button's A contact. These are
 *      real static merges declared by the model.
 *
 * Switchable conduction (a pressed button, a closed DIP switch, a resistor) is
 * deliberately NOT unioned. Those conduct as bidirectional *drivers* so that an
 * open switch actually opens and a resistor still attenuates.
 */

import { stripKey, isValidHole } from '../shared/board-geometry.js';
import { NO_NET } from './constants.js';
import { UnionFind } from './union-find.js';

/**
 * @param {object} circuit  circuit document v1
 * @param {import('./models/registry.js').ModelRegistry} registry
 * @returns {{ netCount:number, netOfStrip:Map<string,number>,
 *             pinNets:Map<string,Int32Array>, warnings:Array<object> }}
 */
export function buildNets(circuit, registry) {
	const warnings = [];
	const uf = new UnionFind(512);

	const boards = Array.isArray(circuit?.boards) ? circuit.boards : [];
	const components = Array.isArray(circuit?.components) ? circuit.components : [];
	const wires = Array.isArray(circuit?.wires) ? circuit.wires : [];
	const boardUids = new Set(boards.map((b) => b?.uid));

	const keyOf = (hole, context) => {
		if (!hole || !isValidHole(hole)) {
			warnings.push({ kind: 'invalidHole', detail: `${context}: hole reference is not a valid position`, hole });
			return null;
		}
		if (!boardUids.has(hole.board)) {
			warnings.push({ kind: 'invalidHole', detail: `${context}: references unknown board "${hole.board}"`, hole });
			return null;
		}
		return stripKey(hole);
	};

	// 1. Strips only become nodes when something references them. An untouched
	//    breadboard would otherwise contribute ~700 empty nets per board.
	// 2. Wires.
	for (const wire of wires) {
		const from = keyOf(wire?.from, `wire ${wire?.uid}`);
		const to = keyOf(wire?.to, `wire ${wire?.uid}`);
		if (from === null || to === null) continue;
		uf.unionKeys(from, to);
	}

	// 3. Component pins. Interning happens before finish() so every referenced
	//    strip gets a net even if no wire touches it.
	/** @type {Map<string, Array<string|null>>} */
	const pinKeys = new Map();
	for (const component of components) {
		const uid = component?.uid;
		if (typeof uid !== 'string') continue;
		if (pinKeys.has(uid)) {
			warnings.push({ kind: 'duplicateUid', detail: `duplicate component uid "${uid}"`, uids: [uid] });
			continue;
		}
		const holes = registry.pinHoles(component);
		const keys = new Array(holes.length);
		for (let i = 0; i < holes.length; i++) {
			const hole = holes[i]?.hole ?? null;
			if (hole === null) {
				keys[i] = null;
				continue;
			}
			const key = keyOf(hole, `${component.type} ${uid} pin ${i + 1}`);
			keys[i] = key;
			if (key !== null) uf.intern(key);
		}
		pinKeys.set(uid, keys);

		// 4. Permanent internal ties (e.g. a push button's two A-side pins).
		for (const [a, b] of registry.internalTies(component)) {
			const ka = keys[a];
			const kb = keys[b];
			if (ka !== null && ka !== undefined && kb !== null && kb !== undefined) uf.unionKeys(ka, kb);
		}
	}

	const { netCount, netOfKey } = uf.finish();

	/** @type {Map<string, Int32Array>} */
	const pinNets = new Map();
	for (const [uid, keys] of pinKeys) {
		const nets = new Int32Array(keys.length);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			nets[i] = key === null ? NO_NET : netOfKey.get(key);
		}
		pinNets.set(uid, nets);
	}

	return { netCount, netOfStrip: netOfKey, pinNets, warnings };
}
