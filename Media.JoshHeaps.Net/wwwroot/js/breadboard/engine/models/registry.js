/**
 * Component model registry.
 *
 * Deliberately shaped for parts this milestone does NOT ship. Milestone 1 is
 * seven combinational chips plus passives, which would be satisfied by a much
 * flatter `{ pins, fn }` shape — but counters, registers, EEPROMs and the NE555
 * are next, and the spec forbids reshaping the registry for them. So the model
 * interface already carries the four things stateful parts need:
 *
 *   (a) per-instance mutable state. `createState(component)` runs once per
 *       placed instance at load. State never lives in a closure captured at
 *       definition time, or every instance of a part would share one counter.
 *   (b) self-scheduled wake-ups. `ctx.scheduleSelf(inst, deltaNs, timerId)`
 *       fires `evaluate` with no input change — an astable NE555 or a clock
 *       source is just a model that reschedules itself.
 *   (c) edge sensitivity. `evaluate` receives a wake record carrying which pin
 *       moved and both its previous and new level, so a flip-flop can test for
 *       a rising edge instead of re-deriving state from levels.
 *   (d) runtime pin direction. Every connected pin owns a driver from load, and
 *       a model may drive or release any pin at any moment. Direction is never
 *       baked into a static descriptor, so a tri-state data bus (an EEPROM
 *       releasing its data pins when /OE is high) needs no new machinery.
 *
 * A model definition is frozen, shared by all instances of the type, and pure
 * apart from the mutation it performs through `ctx`.
 *
 * @typedef {object} ModelDefinition
 * @property {string} type
 * @property {number} pinCount
 * @property {number} [delayNs]        default propagation delay
 * @property {number} [vcc]            1-based power pin, if the part needs power
 * @property {number} [gnd]            1-based ground pin
 * @property {Array<[number,number]>} [ties]  permanent internal shorts, 1-based
 * @property {(component:object)=>object|null} [createState]
 * @property {(ctx:object, inst:object)=>void} [init]
 * @property {(ctx:object, inst:object, wake:object)=>void} evaluate
 * @property {(component:object)=>Array<{pin:*,hole:*}>} [pinHoles] override
 * @property {Array<[number,number]>} [functionalPins] 1-based pin pairs that must
 *   land on DIFFERENT nets for the part to do anything (an LED's two legs, a
 *   resistor's two ends). Used only for the load-time self-short check.
 */

import { componentPinHoles, staticPinBonds, componentSelfShorts, switchablePinBonds } from '../../shared/component-pins.js';
import { DEFAULT_DELAY_NS } from '../constants.js';

/** Why a model is being evaluated. */
export const WAKE_INIT = 0;
export const WAKE_PIN = 1;
export const WAKE_TIMER = 2;

const definitions = new Map();

/** Registers a model definition. Later registration of the same type replaces it. */
export function defineModel(definition) {
	if (!definition || typeof definition.type !== 'string') throw new Error('model definition needs a type');
	if (typeof definition.evaluate !== 'function') throw new Error(`model ${definition.type} needs evaluate()`);
	const frozen = Object.freeze({
		delayNs: DEFAULT_DELAY_NS,
		pinCount: 0,
		ties: [],
		...definition,
	});
	definitions.set(frozen.type, frozen);
	return frozen;
}

export function getModel(type) {
	return definitions.get(type) ?? null;
}

export function knownTypes() {
	return [...definitions.keys()];
}

/**
 * The façade the rest of the engine uses. Kept as an object rather than loose
 * functions so tests can substitute a registry with a subset of models.
 */
export const registry = Object.freeze({
	get: getModel,
	knownTypes,

	/** Pin -> hole mapping. Models may override; default is the shared helper. */
	pinHoles(component) {
		const model = getModel(component?.type);
		if (model?.pinHoles) return model.pinHoles(component);
		try {
			return componentPinHoles(component) ?? [];
		} catch {
			return [];
		}
	},

	/**
	 * Pin pairs the BOARD GEOMETRY puts in a single strip, 0-based.
	 *
	 * shared/component-pins.js already excludes pins that are tied by design, so
	 * a push button's 1-2 and 3-4 do not appear here — verified against every
	 * component type rather than assumed.
	 */
	selfShorts(component) {
		const pairs = componentSelfShorts(component) ?? [];
		return pairs.map(([a, b]) => [a - 1, b - 1]);
	},

	/**
	 * Pin pairs that are supposed to be SEPARATE nets for the component to have
	 * any effect, 0-based: the two sides of every switch contact, and the two
	 * terminals of a two-terminal passive. Design ties are subtracted, so a
	 * permanently-bonded pair is never reported.
	 */
	functionalPairs(component) {
		const model = getModel(component?.type);
		if (!model) return [];
		const tied = new Set(
			(staticPinBonds(component) ?? []).map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)),
		);
		const pairs = [];
		const add = (a, b) => {
			const key = a < b ? `${a}-${b}` : `${b}-${a}`;
			if (!tied.has(key)) pairs.push([a - 1, b - 1]);
		};
		for (const bond of switchablePinBonds(component) ?? []) {
			if (Array.isArray(bond?.pins) && bond.pins.length === 2) add(bond.pins[0], bond.pins[1]);
		}
		for (const [a, b] of model.functionalPins ?? []) add(a, b);
		return pairs;
	},

	/**
	 * Permanent internal shorts, as 0-based pin index pairs.
	 *
	 * shared/component-pins.js is the authority here — it also owns the pin
	 * geometry, and a push button's two A-side pins land on different columns,
	 * so getting these out of step with the layout would silently break every
	 * button. A model's own `ties` are only a fallback for types the shared
	 * registry does not know about.
	 */
	internalTies(component) {
		const shared = staticPinBonds(component);
		if (shared && shared.length > 0) return shared.map(([a, b]) => [a - 1, b - 1]);
		const model = getModel(component?.type);
		if (!model || model.ties.length === 0) return [];
		return model.ties.map(([a, b]) => [a - 1, b - 1]);
	},
});
