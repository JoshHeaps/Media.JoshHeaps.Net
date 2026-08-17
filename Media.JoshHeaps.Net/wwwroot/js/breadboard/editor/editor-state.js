// Editor document state: the circuit, the selection, and what has changed.
//
// DIRTY TRACKING (amendment A9). The circuit is stored in PostgreSQL as jsonb, which
// normalizes object key order and whitespace, so the bytes we send are never the bytes
// that come back. Comparing serialized strings across a save therefore reports a
// document as dirty the moment it is reloaded - and with an autosave that is a loop
// that never settles. So:
//   - the baseline is a deep clone of exactly what we last SENT (never a re-GET),
//   - comparison is structural, over a canonical form with sorted keys,
//   - and no re-GET happens after a save, since PUT returns 204 with no body.
//
// UID ALLOCATION. One long-lived allocator lives here, seeded from the loaded
// document. Allocation is editor session state, not a property of the document, so
// nothing in this module calls shared/'s nextUid.

import {
    createUidAllocator,
    createWire,
    addBoard as schemaAddBoard,
    removeBoard as schemaRemoveBoard,
    boardsByUid,
    allUids,
    validateCircuit,
    MAX_COMPONENTS,
    MAX_WIRES,
    MAX_BOARDS,
    DEFAULT_WIRE_COLOR,
    orientFor
} from '../shared/circuit-schema.js';

import { getComponentDef, dipRowForOrient, defaultPropsFor } from '../shared/component-registry.js';
import { isFullyPlaced, componentSelfShorts } from '../shared/component-pins.js';
import { holeKey, sameHole } from '../shared/board-geometry.js';

/** Uid carried by the placement preview; never added to the circuit. */
const GHOST_UID = '__ghost__';

/** Stable stringification: object keys sorted, so key order never affects equality. */
function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function createEditorState(initialCircuit) {
    let circuit = initialCircuit;
    let baseline = canonical(initialCircuit);
    let allocator = createUidAllocator(allUids(initialCircuit));
    let boards = boardsByUid(circuit);

    const selection = new Set();
    const listeners = new Set();

    /** Components the user is physically holding down right now. Never persisted. */
    const pressed = new Set();

    function notify(change) {
        for (const listener of listeners) listener(change);
    }

    function structureChanged() {
        boards = boardsByUid(circuit);
        notify({ kind: 'circuit' });
    }

    return {
        get circuit() { return circuit; },
        get boards() { return boards; },
        get selection() { return selection; },
        get pressed() { return pressed; },
        get dirty() { return canonical(circuit) !== baseline; },

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /**
         * Mark the document saved. Pass the EXACT payload that was sent - the baseline
         * must be what we sent, never a re-read of the server's copy.
         */
        markSaved(sentPayload) {
            baseline = canonical(sentPayload);
            notify({ kind: 'saved' });
        },

        /** Replace the whole document, e.g. after a load. */
        replace(nextCircuit) {
            circuit = nextCircuit;
            baseline = canonical(nextCircuit);
            allocator = createUidAllocator(allUids(nextCircuit));
            selection.clear();
            pressed.clear();
            structureChanged();
        },

        // --- Selection ---

        select(uid, additive = false) {
            if (!additive) selection.clear();
            if (uid !== null && uid !== undefined) selection.add(uid);
            notify({ kind: 'selection' });
        },

        toggleSelect(uid) {
            if (selection.has(uid)) selection.delete(uid);
            else selection.add(uid);
            notify({ kind: 'selection' });
        },

        clearSelection() {
            if (selection.size === 0) return;
            selection.clear();
            notify({ kind: 'selection' });
        },

        findSelectedComponent() {
            if (selection.size !== 1) return null;
            const uid = [...selection][0];
            return circuit.components.find(c => c.uid === uid) || null;
        },

        // --- Components ---

        /**
         * Build a component of the given type at an anchor, without adding it. Used for
         * the placement ghost so the preview is the real thing.
         */
        buildComponent(type, anchor, extraProps) {
            const def = getComponentDef(type);
            if (def === null) return null;
            // Deliberately does NOT allocate a uid. The placement ghost is rebuilt on
            // every pointer move, and uid allocation is O(document) - doing it here
            // would scan the whole circuit once per mousemove.
            const component = {
                uid: GHOST_UID,
                type,
                props: defaultPropsFor(type)
            };
            if (extraProps) Object.assign(component.props, extraProps);
            if (!def.anchorless) component.anchor = anchor;
            if (def.orientable) component.orient = orientFor(def, anchor, def.defaultOrient);
            return component;
        },

        /**
         * Add a component. Returns { ok, component, reason, warnings }.
         * `warnings` is advisory - a self-shorted part is legal but useless.
         */
        addComponent(type, anchor, extraProps) {
            if (circuit.components.length >= MAX_COMPONENTS) {
                return { ok: false, reason: `A circuit can hold at most ${MAX_COMPONENTS} components.` };
            }
            const def = getComponentDef(type);
            if (def === null) return { ok: false, reason: `Unknown component type "${type}".` };

            const component = {
                uid: allocator.next('c'),
                type,
                props: defaultPropsFor(type)      // deep-copies array defaults
            };
            if (extraProps) Object.assign(component.props, extraProps);
            if (!def.anchorless) component.anchor = anchor;
            if (def.orientable) component.orient = orientFor(def, anchor, def.defaultOrient);

            if (!isFullyPlaced(component)) {
                return { ok: false, reason: `A ${def.label} does not fit there — part of it would hang off the board.` };
            }

            circuit.components.push(component);
            const check = validateCircuit(circuit);
            if (!check.ok) {
                circuit.components.pop();
                return { ok: false, reason: check.errors[0] };
            }

            const warnings = [];
            if (componentSelfShorts(component).length > 0) {
                warnings.push(`This ${def.label} has both ends in the same connected strip, so it will have no effect.`);
            }
            structureChanged();
            return { ok: true, component, warnings };
        },

        /** Move a component to a new anchor. Returns { ok, reason }. */
        moveComponent(uid, anchor) {
            const component = circuit.components.find(c => c.uid === uid);
            if (!component) return { ok: false, reason: 'That component no longer exists.' };
            const def = getComponentDef(component.type);
            if (def.anchorless) return { ok: false, reason: `A ${def.label} is moved by changing its rail, not by dragging.` };

            const previousAnchor = component.anchor;
            const previousOrient = component.orient;
            component.anchor = anchor;
            if (def.orientable) component.orient = orientFor(def, anchor, component.orient);

            if (!isFullyPlaced(component) || !validateCircuit(circuit).ok) {
                component.anchor = previousAnchor;
                component.orient = previousOrient;
                return { ok: false, reason: `A ${def.label} does not fit there.` };
            }
            structureChanged();
            return { ok: true };
        },

        /**
         * Rotate a component. For DIP-style packages this flips the anchor across the
         * center channel, which IS the rotation; for an LED it cycles the orient.
         */
        rotateComponent(uid) {
            const component = circuit.components.find(c => c.uid === uid);
            if (!component) return { ok: false, reason: 'That component no longer exists.' };
            const def = getComponentDef(component.type);
            if (!def.orientable) return { ok: false, reason: `A ${def.label} cannot be rotated.` };

            const previousAnchor = component.anchor;
            const previousOrient = component.orient;

            if (def.dipStyle) {
                const nextOrient = component.orient === 'right' ? 'left' : 'right';
                component.anchor = Object.assign({}, component.anchor, { row: dipRowForOrient(nextOrient) });
                component.orient = nextOrient;
            } else {
                const values = def.orientValues;
                const index = values.indexOf(component.orient);
                component.orient = values[(index + 1) % values.length];
            }

            if (!isFullyPlaced(component) || !validateCircuit(circuit).ok) {
                component.anchor = previousAnchor;
                component.orient = previousOrient;
                return { ok: false, reason: `A ${def.label} does not fit in that orientation here.` };
            }
            structureChanged();
            return { ok: true };
        },

        /** Update a component's props. Reverts and explains if the result is invalid. */
        setComponentProps(uid, changes) {
            const component = circuit.components.find(c => c.uid === uid);
            if (!component) return { ok: false, reason: 'That component no longer exists.' };
            const previous = Object.assign({}, component.props);
            Object.assign(component.props, changes);

            const check = validateCircuit(circuit);
            if (!check.ok || !isFullyPlaced(component)) {
                component.props = previous;
                return { ok: false, reason: check.ok ? 'That change would move a pin off the board.' : check.errors[0] };
            }
            structureChanged();
            return { ok: true };
        },

        /** Toggle one switch of a DIP package. */
        toggleSwitch(uid, switchNumber) {
            const component = circuit.components.find(c => c.uid === uid);
            if (!component || component.type !== 'dipSwitch8') return null;
            const on = Array.isArray(component.props.on) ? component.props.on.slice() : new Array(8).fill(false);
            const index = switchNumber - 1;
            if (index < 0 || index >= on.length) return null;
            on[index] = !on[index];
            component.props.on = on;
            structureChanged();
            return on[index];
        },

        setPressed(uid, isPressed) {
            if (isPressed) pressed.add(uid);
            else pressed.delete(uid);
            notify({ kind: 'runtime' });
        },

        // --- Wires ---

        /** Add a wire. Returns { ok, wire, reason }. */
        addWire(from, to, color) {
            if (circuit.wires.length >= MAX_WIRES) {
                return { ok: false, reason: `A circuit can hold at most ${MAX_WIRES} wires.` };
            }
            if (sameHole(from, to)) {
                return { ok: false, reason: 'A wire needs two different holes.' };
            }
            const duplicate = circuit.wires.some(w =>
                (sameHole(w.from, from) && sameHole(w.to, to)) || (sameHole(w.from, to) && sameHole(w.to, from)));
            if (duplicate) return { ok: false, reason: 'Those holes are already joined by a wire.' };

            const wire = {
                uid: allocator.next('w'),
                from,
                to,
                color: color || DEFAULT_WIRE_COLOR
            };
            circuit.wires.push(wire);
            const check = validateCircuit(circuit);
            if (!check.ok) {
                circuit.wires.pop();
                return { ok: false, reason: check.errors[0] };
            }
            structureChanged();
            return { ok: true, wire };
        },

        setWireColor(uid, color) {
            const wire = circuit.wires.find(w => w.uid === uid);
            if (!wire) return false;
            wire.color = color;
            structureChanged();
            return true;
        },

        // --- Deletion ---

        /** Delete everything selected. Returns the number of items removed. */
        deleteSelected() {
            if (selection.size === 0) return 0;
            const before = circuit.components.length + circuit.wires.length;
            circuit.components = circuit.components.filter(c => !selection.has(c.uid));
            circuit.wires = circuit.wires.filter(w => !selection.has(w.uid));
            const removed = before - (circuit.components.length + circuit.wires.length);
            if (removed > 0) {
                selection.clear();
                structureChanged();
            }
            return removed;
        },

        // --- Boards ---

        addBoard() {
            if (circuit.boards.length >= MAX_BOARDS) {
                return { ok: false, reason: `A circuit can hold at most ${MAX_BOARDS} boards.` };
            }
            const board = schemaAddBoard(circuit);
            if (board === null) return { ok: false, reason: 'Could not add another board.' };
            allocator.claim(board.uid, 'b');
            structureChanged();
            return { ok: true, board };
        },

        /** Remove a board and everything on it. Returns { ok, reason, removed }. */
        removeBoard(uid) {
            if (circuit.boards.length <= 1) {
                return { ok: false, reason: 'A circuit needs at least one board.' };
            }
            const before = circuit.components.length + circuit.wires.length;
            if (!schemaRemoveBoard(circuit, uid)) {
                return { ok: false, reason: 'That board no longer exists.' };
            }
            const removed = before - (circuit.components.length + circuit.wires.length);
            selection.clear();
            structureChanged();
            return { ok: true, removed };
        },

        moveBoard(uid, x, y) {
            const board = circuit.boards.find(b => b.uid === uid);
            if (!board) return false;
            board.x = x;
            board.y = y;
            structureChanged();
            return true;
        },

        /** Component or wire whose uid matches, or null. */
        findByUid(uid) {
            return circuit.components.find(c => c.uid === uid)
                || circuit.wires.find(w => w.uid === uid)
                || null;
        },

        /** Wire whose either end is at the given hole, or null. */
        wireAtHole(hole) {
            const key = holeKey(hole);
            return circuit.wires.find(w => holeKey(w.from) === key || holeKey(w.to) === key) || null;
        }
    };
}

export { canonical };
