// Circuit document schema v1: create, normalize and validate.
//
// PURE MODULE. No DOM, no globals. The structural rules here are mirrored by the
// server-side C# validator, so keep them explicit and keep the error strings terse
// and stable.
//
// Two entry points with deliberately different temperaments:
//   normalizeCircuit  - LENIENT. Coerces anything into a usable document so a user is
//                       never locked out of their own project. It REPORTS everything
//                       it could not keep; it never discards silently.
//   validateCircuit   - STRICT. Mirrors the server. This is the gate.
// INVARIANT: the output of normalizeCircuit always passes validateCircuit. Several
// call sites depend on it, and the shared test suite asserts it by fuzzing.

import {
    isValidHole,
    holeKey,
    BOARD_WIDTH,
    BOARD_HEIGHT
} from './board-geometry.js';

import {
    getComponentDef,
    isKnownType,
    validateProps,
    defaultPropsFor,
    dipOrientForRow
} from './component-registry.js';

import { componentPinHoles, isFullyPlaced } from './component-pins.js';

/** Schema version emitted by this build. */
export const CIRCUIT_VERSION = 1;

/** Maximum length of any uid in the document. */
export const MAX_UID_LENGTH = 40;

// Count caps pinned by team-lead amendment A11, identical in the C# validator. These
// are PRODUCT limits only: passing them says nothing about the byte cap below, because
// a document at every count cap with 40-character uids still measures over 3 MB. The
// two limits are independent and both are enforced.
export const MAX_BOARDS = 50;
export const MAX_COMPONENTS = 3000;
export const MAX_WIRES = 10000;

/**
 * Hard byte ceiling on the serialized document (UTF-8), enforced by the server
 * independently of the count caps. The save path MUST preflight against this with a
 * real byte count - see circuitByteSize - so an oversized document is refused with an
 * explanation rather than surfacing as a bare 400.
 */
export const MAX_CIRCUIT_BYTES = 2 * 1024 * 1024;

/** Uid character set accepted by the server-side validator. */
export const UID_PATTERN = new RegExp(`^[A-Za-z0-9_.:-]{1,${MAX_UID_LENGTH}}$`);

const UID_INVALID_CHARS = /[^A-Za-z0-9_.:-]/g;

/** Horizontal gap left between boards when a new one is appended. */
export const BOARD_STACK_GAP = 60;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Largest absolute board coordinate the server accepts. */
export const MAX_BOARD_COORD = 1000000;

/** Default wire colors offered in the editor, in picker order. */
export const WIRE_COLORS = Object.freeze([
    '#d13438', '#2b6cb0', '#2f9e44', '#e8a33d', '#7048e8', '#f2f2f2', '#1a1a1a', '#e07a9c'
]);

/** Color used for a wire with no explicit color. */
export const DEFAULT_WIRE_COLOR = WIRE_COLORS[1];

/**
 * The orient value a component should carry.
 *
 * For DIP-style packages the real rotation is carried by which side of the channel
 * the anchor sits on, so `orient` is derived from the anchor row rather than stored
 * independently - that keeps the two from ever contradicting each other. Everything
 * else uses `orient` directly.
 */
export function orientFor(def, anchor, requested) {
    if (!def.orientable) return undefined;
    if (def.dipStyle) {
        return anchor && anchor.kind === 'main' ? dipOrientForRow(anchor.row) : def.defaultOrient;
    }
    return def.orientValues.indexOf(requested) !== -1 ? requested : def.defaultOrient;
}

// --- Uid allocation ---

/**
 * Coerce a string into the server's uid charset, or null when nothing usable remains.
 * Renaming beats dropping: a bad uid must never cost the user a component.
 */
export function sanitizeUid(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(UID_INVALID_CHARS, '-').slice(0, MAX_UID_LENGTH);
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Allocates document-unique uids in amortized constant time.
 *
 * nextUid() rebuilds the used-set on every call, which is fine for placing one
 * component but quadratic over a whole document. Any loop that creates more than a
 * handful of items must use this instead.
 * @param {string[]} [existing] uids already taken
 */
export function createUidAllocator(existing = []) {
    const used = new Set(existing);
    const counters = new Map();
    return {
        has(uid) { return used.has(uid); },
        /** Claim `preferred` if it is free and well-formed, otherwise mint one. */
        claim(preferred, prefix) {
            const clean = sanitizeUid(preferred);
            if (clean !== null && !used.has(clean)) {
                used.add(clean);
                return clean;
            }
            return this.next(prefix);
        },
        /** Mint the next free uid with the given prefix. The counter never rewinds. */
        next(prefix) {
            let n = counters.get(prefix) || 1;
            while (used.has(prefix + n)) n++;
            counters.set(prefix, n + 1);
            const uid = prefix + n;
            used.add(uid);
            return uid;
        }
    };
}

// --- Construction ---

/**
 * A new, empty circuit with a single board at the origin.
 * @returns {object}
 */
export function createCircuit() {
    return {
        version: CIRCUIT_VERSION,
        boards: [{ uid: 'b1', x: 0, y: 0 }],
        components: [],
        wires: []
    };
}

/** Structured clone of a circuit, safe to mutate. */
export function cloneCircuit(circuit) {
    return JSON.parse(JSON.stringify(circuit));
}

/**
 * Next unused uid with the given prefix, e.g. nextUid(c, 'c') -> "c7".
 *
 * A pure function of the document: same content, same answer, every time. O(document),
 * which is fine for placing a single item.
 *
 * DO NOT call this in a loop. Filling a document one nextUid at a time is quadratic.
 * Bulk paths use createUidAllocator, and a long-lived editor should keep one allocator
 * alongside its circuit - uid allocation is session state, not a property of the
 * document, and modelling it as the latter does not work.
 */
export function nextUid(circuit, prefix) {
    const used = new Set(allUids(circuit));
    let n = 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
}

/** Every uid in the document. */
export function allUids(circuit) {
    const uids = [];
    for (const list of [circuit.boards, circuit.components, circuit.wires]) {
        if (Array.isArray(list)) {
            for (const item of list) {
                if (item && typeof item.uid === 'string') uids.push(item.uid);
            }
        }
    }
    return uids;
}

/** Board with the given uid, or null. */
export function findBoard(circuit, uid) {
    return circuit.boards.find(b => b.uid === uid) || null;
}

/** Component with the given uid, or null. */
export function findComponent(circuit, uid) {
    return circuit.components.find(c => c.uid === uid) || null;
}

/** Wire with the given uid, or null. */
export function findWire(circuit, uid) {
    return circuit.wires.find(w => w.uid === uid) || null;
}

/**
 * Boards keyed by uid - the shape board-geometry's holeWorldPos expects.
 * @returns {Map<string, object>}
 */
export function boardsByUid(circuit) {
    return new Map(circuit.boards.map(b => [b.uid, b]));
}

/**
 * Append a board below the existing ones and return it. Mutates `circuit`.
 * @returns {object|null} the new board, or null when MAX_BOARDS is reached
 */
export function addBoard(circuit) {
    if (circuit.boards.length >= MAX_BOARDS) return null;
    const bottom = circuit.boards.reduce(
        (max, b) => Math.max(max, b.y + BOARD_HEIGHT), -BOARD_STACK_GAP
    );
    const board = { uid: nextUid(circuit, 'b'), x: 0, y: bottom + BOARD_STACK_GAP };
    circuit.boards.push(board);
    return board;
}

/**
 * Remove a board and everything anchored to or wired into it. Mutates `circuit`.
 * Refuses to remove the last remaining board.
 * @returns {boolean} whether the board was removed
 */
export function removeBoard(circuit, uid) {
    if (circuit.boards.length <= 1) return false;
    const index = circuit.boards.findIndex(b => b.uid === uid);
    if (index === -1) return false;

    circuit.boards.splice(index, 1);
    circuit.wires = circuit.wires.filter(w => !wireTouchesBoard(w, uid));
    circuit.components = circuit.components.filter(c => !componentTouchesBoard(c, uid));
    return true;
}

/** True when either end of a wire sits on the given board. */
export function wireTouchesBoard(wire, boardUid) {
    return (wire.from && wire.from.board === boardUid) || (wire.to && wire.to.board === boardUid);
}

/** True when any part of a component sits on the given board. */
export function componentTouchesBoard(component, boardUid) {
    if (component.anchor && component.anchor.board === boardUid) return true;
    if (component.props && component.props.board === boardUid) return true;
    if (component.props && component.props.to && component.props.to.board === boardUid) return true;
    return componentPinHoles(component).some(p => p.hole !== null && p.hole.board === boardUid);
}

/**
 * A component of the given type with registry defaults applied. Does not add it to
 * the circuit.
 *
 * Anchorless types ignore `anchor` and take their placement from `extraProps`
 * instead - a powerSupply5V needs `{ board, side }` there or it will not validate.
 * @param {object} circuit used only to allocate a uid
 * @param {string} type
 * @param {object|null} anchor hole reference, ignored for anchorless types
 * @param {object} [extraProps] merged over the type defaults
 */
export function createComponent(circuit, type, anchor, extraProps) {
    const def = getComponentDef(type);
    if (def === null) return null;
    const component = {
        uid: nextUid(circuit, 'c'),
        type,
        props: Object.assign(defaultPropsFor(type), extraProps || {})
    };
    // The server-side validator whitelists keys strictly, so an anchorless type omits
    // `anchor` entirely rather than carrying an explicit null.
    if (!def.anchorless) component.anchor = anchor;
    if (def.orientable) component.orient = orientFor(def, anchor, def.defaultOrient);
    return component;
}

/** A wire between two holes, with a uid allocated from the circuit. */
export function createWire(circuit, from, to, color) {
    return {
        uid: nextUid(circuit, 'w'),
        from,
        to,
        color: HEX_COLOR.test(color) ? color : DEFAULT_WIRE_COLOR
    };
}

// --- Normalization ---

function normalizeBoardCoord(value, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(-MAX_BOARD_COORD, Math.min(MAX_BOARD_COORD, value));
}

/**
 * Coerce anything - a parsed JSONB blob, `{}`, null, a JSON string - into a usable
 * circuit, reporting everything that could not be kept.
 *
 * Nothing is discarded silently. Entries with a broken uid are RENAMED rather than
 * dropped, and a board rename is propagated to every hole reference that pointed at
 * it, because dropping a board would cascade into deleting all of its components and
 * wires.
 *
 * @param {*} raw
 * @returns {{circuit: object, problems: Array<{kind:string, index:number, uid:string|null, reason:string}>}}
 */
export function normalizeCircuitWithReport(raw) {
    const problems = [];
    const note = (kind, index, uid, reason) => problems.push({ kind, index, uid, reason });

    let source = raw;
    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            note('circuit', -1, null, 'the saved document was not valid JSON');
            source = null;
        }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return { circuit: createCircuit(), problems };
    }

    // --- boards, with a rename map so hole references follow their board ---
    const rawBoards = Array.isArray(source.boards) ? source.boards : [];
    const allocator = createUidAllocator();
    const renames = new Map();
    const boards = [];

    for (let i = 0; i < rawBoards.length && boards.length < MAX_BOARDS; i++) {
        const rawBoard = rawBoards[i];
        if (!rawBoard || typeof rawBoard !== 'object') {
            note('board', i, null, 'entry was not an object');
            continue;
        }
        const original = typeof rawBoard.uid === 'string' ? rawBoard.uid : null;
        // The FIRST board claiming a name keeps it, so references stay unambiguous.
        const uid = allocator.claim(original, 'b');
        if (original === null) {
            note('board', i, null, `a board had no id and was given "${uid}"`);
        } else if (original !== uid) {
            // Reported even when the name was already remapped: this is the duplicate
            // case, where every reference to it attaches to the FIRST board and this
            // one is left empty. Silent data movement is what the report exists for.
            note('board', i, original, renames.has(original)
                ? `a second board also called "${original}" was renamed to "${uid}"; anything referring to "${original}" stayed with the first one`
                : `board "${original}" was renamed to "${uid}" (unsupported characters)`);
        }
        if (original !== null && !renames.has(original)) renames.set(original, uid);
        boards.push({
            uid,
            x: normalizeBoardCoord(Number(rawBoard.x), 0),
            y: normalizeBoardCoord(Number(rawBoard.y), i * (BOARD_HEIGHT + BOARD_STACK_GAP))
        });
    }
    if (rawBoards.length > MAX_BOARDS) {
        note('board', -1, null, `only the first ${MAX_BOARDS} boards were kept`);
    }
    if (boards.length === 0) boards.push({ uid: allocator.claim('b1', 'b'), x: 0, y: 0 });

    const boardUids = new Set(boards.map(b => b.uid));

    /** Resolve a raw hole reference, following any board rename. */
    const normalizeHole = (rawHole) => {
        if (!rawHole || typeof rawHole !== 'object') return null;
        const board = renames.has(rawHole.board) ? renames.get(rawHole.board) : rawHole.board;
        const hole = rawHole.kind === 'rail'
            ? { board, kind: 'rail', rail: rawHole.rail, index: Number(rawHole.index) }
            : { board, kind: 'main', col: Number(rawHole.col), row: rawHole.row };
        if (!isValidHole(hole) || !boardUids.has(hole.board)) return null;
        return hole;
    };

    // --- components ---
    const rawComponents = Array.isArray(source.components) ? source.components : [];
    const components = [];
    const suppliedRailPairs = new Set();
    for (let i = 0; i < rawComponents.length; i++) {
        if (components.length >= MAX_COMPONENTS) {
            note('component', -1, null, `only the first ${MAX_COMPONENTS} components were kept`);
            break;
        }
        const rawComponent = rawComponents[i];
        const label = rawComponent && typeof rawComponent.uid === 'string' ? rawComponent.uid : null;

        if (!rawComponent || typeof rawComponent !== 'object') {
            note('component', i, null, 'entry was not an object');
            continue;
        }
        if (!isKnownType(rawComponent.type)) {
            note('component', i, label, `unknown component type "${String(rawComponent.type)}"`);
            continue;
        }
        const def = getComponentDef(rawComponent.type);
        const component = {
            uid: allocator.claim(label, 'c'),
            type: rawComponent.type,
            props: defaultPropsFor(rawComponent.type)
        };
        if (label !== null && label !== component.uid) {
            note('component', i, label, `renamed to "${component.uid}" (duplicate or unsupported characters)`);
        }

        if (!def.anchorless) {
            const anchor = normalizeHole(rawComponent.anchor);
            if (anchor === null) {
                note('component', i, label, `${def.label} was not on a board that still exists`);
                continue;
            }
            component.anchor = anchor;
        }

        const rawProps = rawComponent.props && typeof rawComponent.props === 'object'
            ? rawComponent.props : {};
        for (const [key, spec] of Object.entries(def.propSpecs)) {
            const value = rawProps[key];
            if (spec.kind === 'enum' && spec.values.indexOf(value) !== -1) {
                component.props[key] = value;
            } else if (spec.kind === 'number' && Number.isFinite(Number(value))) {
                component.props[key] = Math.min(spec.max, Math.max(spec.min, Number(value)));
            } else if (spec.kind === 'boolArray') {
                const rawList = Array.isArray(value) ? value : [];
                component.props[key] = Array.from({ length: spec.length }, (_, slot) => rawList[slot] === true);
            }
        }

        if (rawComponent.type === 'resistor') {
            const to = normalizeHole(rawProps.to);
            if (to === null) {
                note('component', i, label, 'resistor had no valid second terminal');
                continue;
            }
            component.props.to = to;
        }

        if (rawComponent.type === 'powerSupply5V') {
            const board = renames.has(rawProps.board) ? renames.get(rawProps.board) : rawProps.board;
            if (typeof board !== 'string' || !boardUids.has(board)) {
                note('component', i, label, '5V supply was not on a board that still exists');
                continue;
            }
            component.props.board = board;
            // Two supplies on one rail pair would be spurious contention, and validate
            // rejects it - so normalize must not emit it either.
            const pair = `${board}|${component.props.side}`;
            if (suppliedRailPairs.has(pair)) {
                note('component', i, label,
                    `a second 5V supply on the ${component.props.side} rails of board "${board}" was removed`);
                continue;
            }
            suppliedRailPairs.add(pair);
        }

        if (def.orientable) component.orient = orientFor(def, component.anchor, rawComponent.orient);

        // Enforced here so normalize's output always passes validate: a component with
        // a pin hanging off the end of the board is rejected by the server.
        if (!isFullyPlaced(component)) {
            note('component', i, label, `${def.label} did not fit on the board`);
            continue;
        }
        components.push(component);
    }

    // --- wires ---
    const rawWires = Array.isArray(source.wires) ? source.wires : [];
    const wires = [];
    for (let i = 0; i < rawWires.length; i++) {
        if (wires.length >= MAX_WIRES) {
            note('wire', -1, null, `only the first ${MAX_WIRES} wires were kept`);
            break;
        }
        const rawWire = rawWires[i];
        const label = rawWire && typeof rawWire.uid === 'string' ? rawWire.uid : null;
        if (!rawWire || typeof rawWire !== 'object') {
            note('wire', i, null, 'entry was not an object');
            continue;
        }
        const from = normalizeHole(rawWire.from);
        const to = normalizeHole(rawWire.to);
        if (from === null || to === null) {
            note('wire', i, label, 'wire did not connect two holes that still exist');
            continue;
        }
        if (holeKey(from) === holeKey(to)) {
            note('wire', i, label, 'wire had both ends in the same hole');
            continue;
        }
        const uid = allocator.claim(label, 'w');
        if (label !== null && label !== uid) {
            note('wire', i, label, `renamed to "${uid}" (duplicate or unsupported characters)`);
        }
        wires.push({
            uid,
            from,
            to,
            color: typeof rawWire.color === 'string' && HEX_COLOR.test(rawWire.color)
                ? rawWire.color : DEFAULT_WIRE_COLOR
        });
    }

    return { circuit: { version: CIRCUIT_VERSION, boards, components, wires }, problems };
}

/**
 * normalizeCircuitWithReport, discarding the report. Prefer the reporting form
 * anywhere the user should be told what happened - notably on load.
 * @returns {object} a circuit that passes validateCircuit()
 */
export function normalizeCircuit(raw) {
    return normalizeCircuitWithReport(raw).circuit;
}

/**
 * The exact payload to PUT to the server.
 *
 * The server-side validator whitelists keys strictly at every level and rejects any
 * unknown property, so this rebuilds the document from scratch with only the
 * permitted keys rather than trusting whatever the editor has been mutating. In
 * particular there is NO slot for editor state - viewport, zoom, selection and tool
 * are deliberately kept out of the document and persisted separately.
 * @returns {object}
 */
export function serializeCircuit(circuit) {
    return normalizeCircuit(circuit);
}

/** UTF-8 byte length of the serialized document, for the pre-save size check. */
export function circuitByteSize(circuit) {
    const json = JSON.stringify(circuit);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
    let bytes = 0;
    for (let i = 0; i < json.length; i++) {
        const code = json.codePointAt(i);
        if (code > 0xffff) { bytes += 4; i++; } else if (code > 0x7ff) { bytes += 3; }
        else if (code > 0x7f) { bytes += 2; } else { bytes += 1; }
    }
    return bytes;
}

// --- Validation ---

function checkUid(uid, label, seen, errors) {
    if (typeof uid !== 'string' || uid.length === 0) {
        errors.push(`${label}: uid must be a non-empty string`);
        return false;
    }
    if (!UID_PATTERN.test(uid)) {
        errors.push(`${label}: uid must be 1-${MAX_UID_LENGTH} characters from A-Z a-z 0-9 _ . : -`);
        return false;
    }
    if (seen.has(uid)) {
        errors.push(`${label}: duplicate uid "${uid}"`);
        return false;
    }
    seen.add(uid);
    return true;
}

function checkHole(hole, boardUids, label, errors) {
    if (!isValidHole(hole)) {
        errors.push(`${label}: invalid hole reference`);
        return false;
    }
    if (!boardUids.has(hole.board)) {
        errors.push(`${label}: references unknown board "${hole.board}"`);
        return false;
    }
    return true;
}

/**
 * Full structural validation of a circuit document.
 * @param {*} circuit
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateCircuit(circuit) {
    const errors = [];
    if (!circuit || typeof circuit !== 'object' || Array.isArray(circuit)) {
        return { ok: false, errors: ['circuit must be an object'] };
    }
    if (circuit.version !== CIRCUIT_VERSION) {
        errors.push(`version must be ${CIRCUIT_VERSION}`);
    }
    if (!Array.isArray(circuit.boards) || circuit.boards.length === 0) {
        return { ok: false, errors: errors.concat('boards must be a non-empty array') };
    }
    if (!Array.isArray(circuit.components) || !Array.isArray(circuit.wires)) {
        if (!Array.isArray(circuit.components)) errors.push('components must be an array');
        if (!Array.isArray(circuit.wires)) errors.push('wires must be an array');
        return { ok: false, errors };
    }

    if (circuit.boards.length > MAX_BOARDS) errors.push(`boards: at most ${MAX_BOARDS} allowed`);
    if (circuit.components.length > MAX_COMPONENTS) errors.push(`components: at most ${MAX_COMPONENTS} allowed`);
    if (circuit.wires.length > MAX_WIRES) errors.push(`wires: at most ${MAX_WIRES} allowed`);

    const seen = new Set();
    const boardUids = new Set();
    const suppliedRailPairs = new Set();
    circuit.boards.forEach((board, i) => {
        const label = `boards[${i}]`;
        if (!board || typeof board !== 'object') {
            errors.push(`${label}: must be an object`);
            return;
        }
        if (!checkUid(board.uid, label, seen, errors)) return;
        boardUids.add(board.uid);
        if (!Number.isFinite(board.x) || !Number.isFinite(board.y)) {
            errors.push(`${label}: x and y must be finite numbers`);
        } else if (Math.abs(board.x) > MAX_BOARD_COORD || Math.abs(board.y) > MAX_BOARD_COORD) {
            errors.push(`${label}: x and y must be within +/-${MAX_BOARD_COORD}`);
        }
    });

    circuit.components.forEach((component, i) => {
        const label = `components[${i}]`;
        if (!component || typeof component !== 'object') {
            errors.push(`${label}: must be an object`);
            return;
        }
        if (!checkUid(component.uid, label, seen, errors)) return;

        const def = getComponentDef(component.type);
        if (def === null) {
            errors.push(`${label}: unknown component type "${String(component.type)}"`);
            return;
        }

        if (def.anchorless) {
            if (component.anchor !== null && component.anchor !== undefined) {
                errors.push(`${label}: ${def.type} must not have an anchor`);
            }
        } else if (!checkHole(component.anchor, boardUids, `${label}.anchor`, errors)) {
            return;
        } else {
            if (def.anchorKinds && def.anchorKinds.indexOf(component.anchor.kind) === -1) {
                errors.push(`${label}: ${def.type} cannot be anchored to a ${component.anchor.kind} hole`);
            }
            if (def.anchorRows && component.anchor.kind === 'main'
                && def.anchorRows.indexOf(component.anchor.row) === -1) {
                errors.push(`${label}: ${def.type} must be anchored on row ${def.anchorRows.join(' or ')}`);
            }
        }

        if (def.orientable) {
            if (def.orientValues.indexOf(component.orient) === -1) {
                errors.push(`${label}: orient must be one of ${def.orientValues.join(', ')}`);
            } else if (def.dipStyle && component.anchor && component.anchor.kind === 'main'
                && component.orient !== dipOrientForRow(component.anchor.row)) {
                // A DIP package's rotation is carried by its anchor row; a conflicting
                // orient would make the document self-contradictory.
                errors.push(`${label}: orient "${component.orient}" contradicts anchor row "${component.anchor.row}"`);
            }
        } else if (component.orient !== undefined) {
            errors.push(`${label}: ${def.type} must not have an orient`);
        }

        for (const message of validateProps(component.type, component.props)) {
            errors.push(`${label}: ${message}`);
        }

        const props = component.props || {};
        if (component.type === 'resistor') {
            checkHole(props.to, boardUids, `${label}.props.to`, errors);
        }
        if (component.type === 'powerSupply5V') {
            if (!boardUids.has(props.board)) {
                errors.push(`${label}: props.board references unknown board "${String(props.board)}"`);
            } else {
                // Two supplies on one rail pair is a contradiction the engine would
                // have to resolve as spurious contention.
                const pair = `${props.board}|${props.side}`;
                if (suppliedRailPairs.has(pair)) {
                    errors.push(`${label}: the ${props.side} rail pair of board "${props.board}" already has a 5V supply`);
                }
                suppliedRailPairs.add(pair);
            }
        }

        const unplaced = componentPinHoles(component).filter(p => p.hole === null).map(p => p.pin);
        if (unplaced.length === 1) {
            errors.push(`${label}: pin ${unplaced[0]} falls off the board`);
        } else if (unplaced.length > 1) {
            errors.push(`${label}: pins ${unplaced.join(', ')} fall off the board`);
        }
    });

    circuit.wires.forEach((wire, i) => {
        const label = `wires[${i}]`;
        if (!wire || typeof wire !== 'object') {
            errors.push(`${label}: must be an object`);
            return;
        }
        if (!checkUid(wire.uid, label, seen, errors)) return;
        const fromOk = checkHole(wire.from, boardUids, `${label}.from`, errors);
        const toOk = checkHole(wire.to, boardUids, `${label}.to`, errors);
        if (fromOk && toOk && holeKey(wire.from) === holeKey(wire.to)) {
            errors.push(`${label}: both ends are the same hole`);
        }
        if (typeof wire.color !== 'string' || !HEX_COLOR.test(wire.color)) {
            errors.push(`${label}: color must be a #rrggbb string`);
        }
    });

    return { ok: errors.length === 0, errors };
}

/**
 * World-space bounding box covering every board, used to frame the initial view.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function circuitBounds(circuit) {
    if (circuit.boards.length === 0) {
        return { x: 0, y: 0, w: BOARD_WIDTH, h: BOARD_HEIGHT };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const board of circuit.boards) {
        minX = Math.min(minX, board.x);
        minY = Math.min(minY, board.y);
        maxX = Math.max(maxX, board.x + BOARD_WIDTH);
        maxY = Math.max(maxY, board.y + BOARD_HEIGHT);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export { componentPinHoles };
