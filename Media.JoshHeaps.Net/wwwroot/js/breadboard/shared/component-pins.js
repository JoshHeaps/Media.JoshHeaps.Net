// Pin-to-hole mapping for every component type.
//
// PURE MODULE. No DOM, no globals. Imported by the editor, by the engine inside a
// module Worker, and mirrored structurally by the C# validator - so this file is the
// single source of truth for where a component's pins physically land.
//
// componentPinHoles() always returns one entry per pin of the type, in pin order,
// with array index 0 being pin 1. A pin whose hole would fall off the board comes
// back as `hole: null` - an unplaced pin, never an exception.

import {
    MAIN_ROWS,
    mainHole,
    railHole,
    offsetHole,
    isValidHole,
    sameStrip
} from './board-geometry.js';

import { getComponentDef, isChipType } from './component-registry.js';

const DIP8_PIN_COUNT = 16;
const DIP8_PINS_PER_SIDE = 8;

function entry(pin, hole) {
    return { pin, hole: hole === undefined ? null : hole };
}

function nullPins(count) {
    const pins = [];
    for (let i = 1; i <= count; i++) pins.push(entry(i, null));
    return pins;
}

function isMainAnchor(anchor) {
    return isValidHole(anchor) && anchor.kind === 'main';
}

/** Row directly across the center channel from `row`, or null when there isn't one. */
function acrossChannel(row) {
    const i = MAIN_ROWS.indexOf(row);
    if (i === -1) return null;
    return row === 'e' ? 'f' : (row === 'f' ? 'e' : null);
}

// --- Per-type mappings ---

function ledPins(component) {
    const anchor = component.anchor;
    if (!isValidHole(anchor)) return nullPins(2);
    // The default lives in the registry so it cannot drift from what the schema writes.
    const dir = component.orient || getComponentDef('led').defaultOrient;
    return [entry(1, anchor), entry(2, offsetHole(anchor, dir, 1))];
}

function resistorPins(component) {
    const anchor = isValidHole(component.anchor) ? component.anchor : null;
    const to = component.props && isValidHole(component.props.to) ? component.props.to : null;
    return [entry(1, anchor), entry(2, to)];
}

/**
 * DIP-style package straddling the center channel, anchored at pin 1.
 *
 * The offsets come from `def.footprint.pins` in the registry rather than being
 * recomputed here, so the published footprint table and this resolver cannot drift.
 * Each entry gives a column offset `dCol` in the package's reading direction and a
 * `side` of the channel.
 *
 * Anchoring on row 'e' reads left to right (notch at the left); anchoring on row 'f'
 * is the identical package rotated 180 degrees, which is why only the sign of the
 * column step changes - the pin numbering never does.
 */
function dipFootprint(component, footprint) {
    const anchor = component.anchor;
    if (!isMainAnchor(anchor)) return nullPins(footprint.pinCount);
    const farRow = acrossChannel(anchor.row);
    if (farRow === null) return nullPins(footprint.pinCount);

    const { board, col, row } = anchor;
    const step = row === 'e' ? 1 : -1;
    return footprint.pins.map(spec => entry(
        spec.pin,
        mainHole(board, col + step * spec.dCol, spec.side === 'anchor' ? row : farRow)
    ));
}

/** Two-pin part whose second pin is one step from the anchor in `orient`. */
function orientStepFootprint(component, footprint, def) {
    const anchor = component.anchor;
    if (!isValidHole(anchor)) return nullPins(footprint.pinCount);
    // The default lives in the registry so it cannot drift from what the schema writes.
    const dir = component.orient || def.defaultOrient;
    return footprint.pins.map(spec => entry(
        spec.pin,
        spec.at === 'anchor' ? anchor : offsetHole(anchor, dir, spec.steps)
    ));
}

/** Two-pin part whose second pin is a free hole reference carried in props. */
function endpointsFootprint(component, footprint) {
    const props = component.props || {};
    return footprint.pins.map(spec => {
        const hole = spec.at === 'anchor' ? component.anchor : props[spec.prop];
        return entry(spec.pin, isValidHole(hole) ? hole : null);
    });
}

/**
 * Anchorless part that clamps onto a rail pair. Returning real hole references keeps
 * it uniform with every other component, so consumers need no special case.
 */
function railPairFootprint(component, footprint) {
    const props = component.props || {};
    const board = props.board;
    const side = props.side;
    if (typeof board !== 'string' || board.length === 0) return nullPins(footprint.pinCount);
    // Validation is the single authority on `side`. Silently coercing an unrecognized
    // value to 'top' here would make the pin map disagree with the validator, and the
    // engine follows the pin map.
    if (side !== 'top' && side !== 'bottom') return nullPins(footprint.pinCount);
    const prefix = side === 'top' ? 'top' : 'bottom';
    return footprint.pins.map(spec => entry(
        spec.pin,
        railHole(board, prefix + (spec.polarity === 'plus' ? 'Plus' : 'Minus'), spec.index)
    ));
}

/**
 * Where each pin of a component physically lands.
 *
 * Dispatches on the registry's declarative footprint, so adding a component type is a
 * registry edit unless it needs a genuinely new footprint kind.
 * @param {object} component a circuit component: { type, anchor, orient?, props? }
 * @returns {Array<{pin:number, hole:object|null}>} index 0 is pin 1; [] for an
 *          unknown type. `hole` is null for a pin that falls off the board.
 */
export function componentPinHoles(component) {
    if (!component || typeof component !== 'object') return [];
    const def = getComponentDef(component.type);
    if (def === null) return [];
    const footprint = def.footprint;
    if (!footprint) return nullPins(def.pins.length);

    switch (footprint.kind) {
        case 'dip': return dipFootprint(component, footprint);
        case 'orientStep': return orientStepFootprint(component, footprint, def);
        case 'endpoints': return endpointsFootprint(component, footprint);
        case 'railPair': return railPairFootprint(component, footprint);
        default: return nullPins(footprint.pinCount);
    }
}

/**
 * Pin holes annotated with the pin names from the registry.
 * @returns {Array<{pin:number, name:string, hole:object|null}>}
 */
export function componentPinsWithNames(component) {
    const def = getComponentDef(component && component.type);
    const holes = componentPinHoles(component);
    return holes.map((h, i) => ({
        pin: h.pin,
        name: def && def.pins[i] ? def.pins[i].name : String(h.pin),
        hole: h.hole
    }));
}

/**
 * Every hole a component occupies, skipping unplaced pins.
 * @returns {object[]}
 */
export function componentHoles(component) {
    return componentPinHoles(component)
        .map(p => p.hole)
        .filter(h => h !== null);
}

/**
 * True when every pin of the component landed on a real hole.
 * @returns {boolean}
 */
export function isFullyPlaced(component) {
    const pins = componentPinHoles(component);
    return pins.length > 0 && pins.every(p => p.hole !== null);
}

/**
 * Pins that land in the same electrical strip as another pin of the same component.
 *
 * Structurally legal but almost always a mistake - an LED with both legs in one
 * terminal strip can never light, because both ends sit on the same net. The editor
 * warns on it and the engine can use it to explain a dead component. It is
 * deliberately NOT a validation error.
 * @returns {Array<[number, number]>} pairs of pin numbers sharing a strip
 */
export function componentSelfShorts(component) {
    const pins = componentPinHoles(component).filter(p => p.hole !== null);
    const bonded = new Set(
        staticPinBonds(component).map(([a, b]) => a < b ? `${a}:${b}` : `${b}:${a}`)
    );
    const shorts = [];
    for (let i = 0; i < pins.length; i++) {
        for (let j = i + 1; j < pins.length; j++) {
            const key = `${pins[i].pin}:${pins[j].pin}`;
            if (bonded.has(key)) continue;      // an intentional internal tie, not a fault
            if (sameStrip(pins[i].hole, pins[j].hole)) shorts.push([pins[i].pin, pins[j].pin]);
        }
    }
    return shorts;
}

/**
 * Pin pairs a component ties together unconditionally, regardless of simulation
 * state. The engine may safely union these at load time.
 * @returns {Array<[number, number]>} pairs of pin numbers
 */
export function staticPinBonds(component) {
    if (!component || component.type !== 'pushButton') return [];
    return [[1, 2], [3, 4]];
}

/**
 * Pin pairs a switch closes when it is on. Not for the engine's signal model - it is
 * here so the editor can draw switch state consistently with the engine.
 * @returns {Array<{control:number, pins:[number, number]}>} `control` is the switch
 *          number the user toggles (1..8 for a DIP, 1 for a push button)
 */
export function switchablePinBonds(component) {
    if (!component) return [];
    if (component.type === 'pushButton') return [{ control: 1, pins: [1, 3] }];
    if (component.type === 'dipSwitch8') {
        const bonds = [];
        for (let k = 1; k <= DIP8_PINS_PER_SIDE; k++) {
            bonds.push({ control: k, pins: [k, DIP8_PIN_COUNT + 1 - k] });
        }
        return bonds;
    }
    return [];
}
