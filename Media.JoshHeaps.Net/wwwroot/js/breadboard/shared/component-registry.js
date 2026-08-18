// Component type registry: metadata shared by the editor palette, the schema
// validator and the engine.
//
// PURE MODULE. No DOM, no globals, no dependencies. Runs in a module Worker and in
// bare node. Physical facts only - nothing theme-dependent lives here except LED
// colors, which are a property of the part rather than of the UI.
//
// Milestone 1 registry. New types bolt on by adding an entry; nothing else in the
// codebase enumerates types.

/** DIP logic chips available in milestone 1. All 14-pin. */
export const CHIP_TYPES = Object.freeze([
    '74HC00', '74HC02', '74HC04', '74HC08', '74HC32', '74HC86', '74HC30'
]);

const CHIP_LABELS = Object.assign(Object.create(null), {
    '74HC00': 'Quad 2-input NAND',
    '74HC02': 'Quad 2-input NOR',
    '74HC04': 'Hex inverter',
    '74HC08': 'Quad 2-input AND',
    '74HC32': 'Quad 2-input OR',
    '74HC86': 'Quad 2-input XOR',
    '74HC30': '8-input NAND'
});
Object.freeze(CHIP_LABELS);

/** Selectable LED colors. `hex` is the physical lens color, not a theme color. */
export const LED_COLORS = Object.freeze([
    Object.freeze({ value: 'red', label: 'Red', hex: '#ff3b30' }),
    Object.freeze({ value: 'green', label: 'Green', hex: '#34c759' }),
    Object.freeze({ value: 'blue', label: 'Blue', hex: '#4a90ff' }),
    Object.freeze({ value: 'yellow', label: 'Yellow', hex: '#ffd60a' }),
    Object.freeze({ value: 'orange', label: 'Orange', hex: '#ff9f0a' }),
    Object.freeze({ value: 'white', label: 'White', hex: '#f2f2f7' })
]);

const LED_COLOR_VALUES = Object.freeze(LED_COLORS.map(c => c.value));

/** Minimum / maximum resistance a resistor may be given, in ohms. */
export const RESISTOR_MIN_OHMS = 1;
export const RESISTOR_MAX_OHMS = 10000000;

/** Common resistor values offered in the property editor. */
export const RESISTOR_PRESETS = Object.freeze([100, 220, 330, 470, 1000, 2200, 4700, 10000, 100000]);

function numberedPins(count) {
    const pins = [];
    for (let i = 1; i <= count; i++) pins.push(Object.freeze({ pin: i, name: String(i) }));
    return Object.freeze(pins);
}

function namedPins(names) {
    return Object.freeze(names.map((name, i) => Object.freeze({ pin: i + 1, name })));
}

/**
 * Orientations a DIP-style package may carry. The package's real rotation is derived
 * from which side of the channel its anchor sits on (row 'e' reads left-to-right,
 * row 'f' is the same package turned 180 degrees), and `orient` is kept consistent
 * with that so the document never contradicts itself.
 */
export const DIP_ORIENTATIONS = Object.freeze(['right', 'left']);

/** The orient value implied by a DIP-style package's anchor row. */
export function dipOrientForRow(row) {
    return row === 'f' ? 'left' : 'right';
}

/** The anchor row implied by a DIP-style package's orient. */
export function dipRowForOrient(orient) {
    return orient === 'left' ? 'f' : 'e';
}

/**
 * Pin offsets for a standard DIP package straddling the center channel.
 *
 * Declarative on purpose: this table IS the footprint contract, mirrored as data by
 * the C# validator. Resolving it is component-pins' job, so the rule can never drift
 * between the description and the implementation.
 *
 * `dCol` is a column offset from the anchor, applied in the package's reading
 * direction; `side` says which side of the channel the pin sits on.
 */
function dipPinOffsets(count) {
    const half = count / 2;
    const pins = [];
    for (let pin = 1; pin <= half; pin++) {
        pins.push(Object.freeze({ pin, dCol: pin - 1, side: 'anchor' }));
    }
    for (let pin = half + 1; pin <= count; pin++) {
        pins.push(Object.freeze({ pin, dCol: count - pin, side: 'far' }));
    }
    return Object.freeze(pins);
}

function chipDef(type) {
    return {
        type,
        label: type,
        description: CHIP_LABELS[type],
        category: 'chip',
        pins: numberedPins(14),
        // A 14-pin DIP straddles the center channel; its body covers 7 columns.
        bodyColumns: 7,
        straddlesGap: true,
        anchorRows: Object.freeze(['e', 'f']),
        anchorKinds: Object.freeze(['main']),
        anchorless: false,
        orientable: true,
        orientValues: DIP_ORIENTATIONS,
        defaultOrient: 'right',
        dipStyle: true,
        footprint: Object.freeze({ kind: 'dip', pinCount: 14, pins: dipPinOffsets(14) }),
        defaultProps: Object.freeze({}),
        propSpecs: Object.freeze({})
    };
}

/**
 * Orientations a three-legged inline package may carry. Its legs run along a row, so
 * only the two horizontal directions leave each leg in a strip of its own: a column's
 * rows a-e are one strip, which would short two legs of any vertical placement.
 */
export const INLINE_ORIENTATIONS = Object.freeze(['left', 'right']);

/** Footprint for a part whose pins step away from the anchor in the orient direction. */
function orientStepFootprint(pinCount) {
    const pins = [];
    for (let pin = 1; pin <= pinCount; pin++) {
        pins.push(pin === 1
            ? Object.freeze({ pin, at: 'anchor' })
            : Object.freeze({ pin, at: 'orientStep', steps: pin - 1 }));
    }
    return Object.freeze({ kind: 'orientStep', pinCount, pins: Object.freeze(pins) });
}

/**
 * The four transistors differ only in polarity and in what their legs are called; the
 * package, the footprint and the placement rules are one part. Pin order is the
 * physical TO-92 one, control terminal in the middle.
 */
function transistorDef(type, label, description, pinNames) {
    return {
        type,
        label,
        description,
        category: 'semiconductor',
        pins: namedPins(pinNames),
        bodyColumns: 3,
        straddlesGap: false,
        anchorRows: null,
        // A power rail is one continuous strip, so all three legs there would be common.
        anchorKinds: Object.freeze(['main']),
        anchorless: false,
        orientable: true,
        orientValues: INLINE_ORIENTATIONS,
        defaultOrient: 'right',
        dipStyle: false,
        footprint: orientStepFootprint(3),
        defaultProps: Object.freeze({}),
        propSpecs: Object.freeze({})
    };
}

const DEFS = Object.create(null);

function define(def) {
    DEFS[def.type] = Object.freeze(def);
}

define({
    type: 'led',
    label: 'LED',
    description: 'Light emitting diode. Anchor is the anode; the cathode sits one hole away.',
    category: 'output',
    pins: namedPins(['anode', 'cathode']),
    bodyColumns: 1,
    straddlesGap: false,
    anchorRows: null,                       // any row
    anchorKinds: Object.freeze(['main', 'rail']),
    anchorless: false,
    orientable: true,
    orientValues: Object.freeze(['up', 'down', 'left', 'right']),
    // 'right' is the only default that reaches a different strip from every main
    // column and also works from a rail hole. 'down' would land in the SAME 5-hole
    // terminal strip from 8 of 10 rows, giving a shorted LED that can never light.
    defaultOrient: 'right',
    dipStyle: false,
    footprint: Object.freeze({
        kind: 'orientStep',
        pinCount: 2,
        pins: Object.freeze([
            Object.freeze({ pin: 1, at: 'anchor' }),
            Object.freeze({ pin: 2, at: 'orientStep', steps: 1 })
        ])
    }),
    defaultProps: Object.freeze({ color: 'red' }),
    propSpecs: Object.freeze({
        color: Object.freeze({ kind: 'enum', values: LED_COLOR_VALUES, default: 'red', label: 'Color' })
    })
});

define({
    type: 'resistor',
    label: 'Resistor',
    description: 'Two-terminal resistor. The second terminal is a free hole reference, so it may span boards or reach a rail.',
    category: 'passive',
    pins: namedPins(['p1', 'p2']),
    bodyColumns: 1,
    straddlesGap: false,
    anchorRows: null,
    anchorKinds: Object.freeze(['main', 'rail']),
    anchorless: false,
    orientable: false,
    footprint: Object.freeze({
        kind: 'endpoints',
        pinCount: 2,
        pins: Object.freeze([
            Object.freeze({ pin: 1, at: 'anchor' }),
            Object.freeze({ pin: 2, at: 'prop', prop: 'to' })
        ])
    }),
    // `to` is a hole reference rather than a scalar, so it is not in propSpecs -
    // circuit-schema validates it structurally.
    defaultProps: Object.freeze({ ohms: 220 }),
    propSpecs: Object.freeze({
        ohms: Object.freeze({
            kind: 'number', min: RESISTOR_MIN_OHMS, max: RESISTOR_MAX_OHMS,
            integer: false, default: 220, label: 'Resistance', unit: 'Ω',
            presets: RESISTOR_PRESETS
        })
    })
});

define({
    type: 'diode',
    label: 'Diode',
    description: 'Signal diode (1N4148). Anchor is the anode; the banded cathode sits one hole away. Passes current one way only.',
    category: 'semiconductor',
    pins: namedPins(['anode', 'cathode']),
    bodyColumns: 1,
    straddlesGap: false,
    anchorRows: null,
    anchorKinds: Object.freeze(['main', 'rail']),
    anchorless: false,
    orientable: true,
    orientValues: Object.freeze(['up', 'down', 'left', 'right']),
    // Same reasoning as the LED: 'right' is the only default that reaches a different
    // strip from every main column and also works from a rail hole.
    defaultOrient: 'right',
    dipStyle: false,
    footprint: orientStepFootprint(2),
    defaultProps: Object.freeze({}),
    propSpecs: Object.freeze({})
});

const TRANSISTOR_DEFS = Object.freeze([
    transistorDef('npn', 'NPN',
        'NPN transistor (2N3904): emitter, base, collector. Conducts when the base is high and the emitter is the low side, so it switches a load to ground.',
        ['emitter', 'base', 'collector']),
    transistorDef('pnp', 'PNP',
        'PNP transistor (2N3906): emitter, base, collector. Conducts when the base is low and the emitter is the high side, so it switches a load to the supply.',
        ['emitter', 'base', 'collector']),
    transistorDef('nmos', 'N-MOSFET',
        'N-channel MOSFET (2N7000): source, gate, drain. Conducts when the gate is high and the source is the low side. The gate draws no current, so it needs a pull-down to stay off.',
        ['source', 'gate', 'drain']),
    transistorDef('pmos', 'P-MOSFET',
        'P-channel MOSFET (BS250): source, gate, drain. Conducts when the gate is low and the source is the high side. The gate draws no current, so it needs a pull-up to stay off.',
        ['source', 'gate', 'drain'])
]);

for (const def of TRANSISTOR_DEFS) define(def);

define({
    type: 'pushButton',
    label: 'Push button',
    description: 'Momentary tactile switch straddling the center channel. Its two same-side pins are permanently tied; pressing bridges the two sides.',
    category: 'input',
    pins: namedPins(['a1', 'a2', 'b1', 'b2']),
    bodyColumns: 3,
    straddlesGap: true,
    anchorRows: Object.freeze(['e', 'f']),
    anchorKinds: Object.freeze(['main']),
    anchorless: false,
    orientable: true,
    orientValues: DIP_ORIENTATIONS,
    defaultOrient: 'right',
    dipStyle: true,
    // Pins 1/2 are tied inside the package, as are 3/4; pressing bridges the pairs.
    // The tied pins sit two columns apart so each tie bonds two separate strips.
    footprint: Object.freeze({
        kind: 'dip',
        pinCount: 4,
        pins: Object.freeze([
            Object.freeze({ pin: 1, dCol: 0, side: 'anchor' }),
            Object.freeze({ pin: 2, dCol: 2, side: 'anchor' }),
            Object.freeze({ pin: 3, dCol: 0, side: 'far' }),
            Object.freeze({ pin: 4, dCol: 2, side: 'far' })
        ])
    }),
    defaultProps: Object.freeze({}),
    propSpecs: Object.freeze({})
});

define({
    type: 'dipSwitch8',
    label: 'DIP switch (8)',
    description: 'Eight independent switches straddling the center channel; switch k bridges the gap in its own column.',
    category: 'input',
    pins: numberedPins(16),
    bodyColumns: 8,
    straddlesGap: true,
    anchorRows: Object.freeze(['e', 'f']),
    anchorKinds: Object.freeze(['main']),
    anchorless: false,
    orientable: true,
    orientValues: DIP_ORIENTATIONS,
    defaultOrient: 'right',
    dipStyle: true,
    switchCount: 8,
    footprint: Object.freeze({ kind: 'dip', pinCount: 16, pins: dipPinOffsets(16) }),
    // Switch positions ARE persisted: they change what the circuit does, so they
    // belong in the document that describes it. Bounded by construction - exactly 8
    // booleans - which is what made this acceptable where a free-form slot was not.
    defaultProps: Object.freeze({ on: Object.freeze([false, false, false, false, false, false, false, false]) }),
    propSpecs: Object.freeze({
        on: Object.freeze({
            kind: 'boolArray', length: 8, label: 'Switches',
            default: Object.freeze([false, false, false, false, false, false, false, false])
        })
    })
});

define({
    type: 'powerSupply5V',
    label: '5V supply',
    description: 'Drives one rail pair: the plus rail to 5V and the minus rail to ground.',
    category: 'power',
    pins: namedPins(['v+', 'gnd']),
    bodyColumns: 0,
    straddlesGap: false,
    anchorRows: null,
    anchorKinds: null,
    anchorless: true,                       // positioned by props.board + props.side
    orientable: false,
    footprint: Object.freeze({
        kind: 'railPair',
        pinCount: 2,
        pins: Object.freeze([
            Object.freeze({ pin: 1, at: 'rail', polarity: 'plus', index: 1 }),
            Object.freeze({ pin: 2, at: 'rail', polarity: 'minus', index: 1 })
        ])
    }),
    defaultProps: Object.freeze({ side: 'top' }),
    propSpecs: Object.freeze({
        side: Object.freeze({ kind: 'enum', values: Object.freeze(['top', 'bottom']), default: 'top', label: 'Rail pair' })
    })
});

for (const type of CHIP_TYPES) define(chipDef(type));
Object.freeze(DEFS);

/** All registered component type names, in palette order. */
export const COMPONENT_TYPES = Object.freeze([
    'led', 'resistor', 'diode', ...TRANSISTOR_DEFS.map(d => d.type),
    'pushButton', 'dipSwitch8', 'powerSupply5V', ...CHIP_TYPES
]);

/** Valid `orient` values for orientable components. */
export const ORIENTATIONS = Object.freeze(['up', 'down', 'left', 'right']);

/**
 * Definition for a component type.
 * @returns {object|null} frozen definition, or null for an unknown type
 */
export function getComponentDef(type) {
    return DEFS[type] || null;
}

/** True when `type` is a registered component type. */
export function isKnownType(type) {
    return typeof type === 'string' && DEFS[type] !== undefined;
}

/** True when `type` is one of the DIP logic chips. */
export function isChipType(type) {
    return CHIP_TYPES.indexOf(type) !== -1;
}

/** Number of pins a component type has. */
export function pinCount(type) {
    const def = DEFS[type];
    return def ? def.pins.length : 0;
}

/** Physical lens color for an LED color name; falls back to red. */
export function ledColorHex(value) {
    const found = LED_COLORS.find(c => c.value === value);
    return found ? found.hex : LED_COLORS[0].hex;
}

/**
 * Props filled in with the type's defaults. Returns a fresh mutable object; array
 * defaults (the DIP switch state) are copied so callers cannot mutate the registry.
 * @returns {object}
 */
export function defaultPropsFor(type) {
    const def = DEFS[type];
    if (!def) return {};
    const props = {};
    for (const [key, value] of Object.entries(def.defaultProps)) {
        props[key] = Array.isArray(value) ? value.slice() : value;
    }
    return props;
}

/**
 * Validate a component's scalar props against the type's propSpecs. Hole-reference
 * props (resistor `to`) and placement rules are checked by circuit-schema instead.
 * @returns {string[]} error messages, empty when valid
 */
export function validateProps(type, props) {
    const def = DEFS[type];
    if (!def) return [`unknown component type "${String(type)}"`];
    if (props === undefined || props === null) return [];
    if (typeof props !== 'object' || Array.isArray(props)) return ['props must be an object'];

    const errors = [];
    for (const [key, spec] of Object.entries(def.propSpecs)) {
        const value = props[key];
        if (value === undefined) continue;       // absent props fall back to defaults
        if (spec.kind === 'enum' && spec.values.indexOf(value) === -1) {
            errors.push(`${type}.${key} must be one of ${spec.values.join(', ')}`);
        } else if (spec.kind === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                errors.push(`${type}.${key} must be a finite number`);
            } else if (value < spec.min || value > spec.max) {
                errors.push(`${type}.${key} must be between ${spec.min} and ${spec.max}`);
            }
        } else if (spec.kind === 'boolArray') {
            if (!Array.isArray(value)) {
                errors.push(`${type}.${key} must be an array`);
            } else if (value.length !== spec.length) {
                errors.push(`${type}.${key} must have exactly ${spec.length} entries`);
            } else if (value.some(v => typeof v !== 'boolean')) {
                errors.push(`${type}.${key} entries must all be true or false`);
            }
        }
    }

    // The server-side validator whitelists props keys per type and rejects anything
    // else, so catch a stray key here rather than as a 400 after the save is sent.
    const allowed = allowedPropKeys(type);
    for (const key of Object.keys(props)) {
        if (allowed.indexOf(key) === -1) {
            errors.push(`${type}.${key} is not a valid property`);
        }
    }
    return errors;
}

// Props that are hole references rather than scalars, so they have no propSpec entry
// but are still permitted by the server.
const EXTRA_PROP_KEYS = Object.freeze(Object.assign(Object.create(null), {
    resistor: Object.freeze(['to']),
    powerSupply5V: Object.freeze(['board'])
}));

/**
 * Every props key a component type may carry in a persisted document.
 * @returns {string[]}
 */
export function allowedPropKeys(type) {
    const def = DEFS[type];
    if (!def) return [];
    return Object.keys(def.propSpecs).concat(EXTRA_PROP_KEYS[type] || []);
}
