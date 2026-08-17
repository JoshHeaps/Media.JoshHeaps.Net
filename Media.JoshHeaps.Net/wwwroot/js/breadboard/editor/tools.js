// Pointer and keyboard interaction.
//
// All mouse coordinates here are SCREEN space (CSS pixels relative to the canvas), and
// are converted to world space through the viewport before touching any geometry.
// devicePixelRatio never appears - see the policy note in renderer.js.
//
// Modes:
//   select        click to select, drag a component to move it, drag empty space to pan
//   wire          drag from hole to hole
//   place:<type>  a ghost follows the cursor; click a hole to commit
// Space or the middle button pans in any mode.

import {
    holeAtWorldPoint,
    holeWorldPos,
    holesInStrip,
    sameHole,
    UPPER_ROWS,
    BOARD_WIDTH,
    BOARD_HEIGHT,
    PITCH
} from '../shared/board-geometry.js';

import { getComponentDef } from '../shared/component-registry.js';
import { componentPinHoles } from '../shared/component-pins.js';
import { componentBounds } from './component-art.js';
import { createListenerBag } from './dom.js';

/** Pointer travel (screen px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;

// How close the cursor must be to a hole, in WORLD units, to snap onto it.
//
// board-geometry's HOLE_HIT_RADIUS is half a pitch, which leaves the corners of every
// cell dead - roughly a fifth of the board selects nothing. That is a UI feel decision
// rather than a geometry fact, so the editor picks its own, more generous radius here.
// At 0.7 the snap regions of neighbouring holes overlap slightly and nearest-hole wins,
// so there is effectively no dead space and no risk of snapping to a distant hole.
const HOLE_SNAP_RADIUS = PITCH * 0.7;

// WheelEvent.deltaY is only in pixels when deltaMode is 0. Firefox reports deltaMode 1
// (LINES, ~3 per notch) where Chrome reports 0 (PIXELS, ~100 per notch) - a ~32x
// difference that makes an un-normalized zoom unusable outside Chromium. Normalizing at
// the event boundary keeps viewport.js in pixels and unaware of DOM event quirks, the
// same way it is kept unaware of devicePixelRatio.
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_FALLBACK_PX = 400;

/**
 * The row a DIP-style package should anchor to for a hole the user clicked: the near
 * side of the centre channel. Uses the shared row grouping rather than comparing row
 * letters, so it cannot drift if the row alphabet ever changes.
 */
function channelSideRow(hole) {
    return UPPER_ROWS.indexOf(hole.row) !== -1 ? 'e' : 'f';
}

function pointInRect(x, y, rect) {
    return rect !== null && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function createTools(options) {
    const { canvas, viewport, state, renderer, sim, status, onSceneChange, onSelectionChange } = options;
    const bag = createListenerBag();

    let tool = { kind: 'select', type: null };
    let wireColor = options.initialWireColor;
    let spaceHeld = false;

    // Transient interaction state
    let gesture = null;     // { kind, ... }
    let hoverHole = null;
    let hoverComponentUid = null;

    function screenPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    /** Whether a pointer event happened over the canvas itself. */
    function isOverCanvas(event) {
        const rect = canvas.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }

    function worldPoint(event) {
        const point = screenPoint(event);
        return viewport.screenToWorld(point.x, point.y);
    }

    function holeAt(world) {
        // Radius is in world units, so snapping feels the same at every zoom.
        return holeAtWorldPoint(world.x, world.y, state.circuit.boards, HOLE_SNAP_RADIUS);
    }

    function componentAt(world) {
        // Only boards under the cursor can hold the component under the cursor, so a
        // cheap board test skips resolving pin geometry for everything elsewhere.
        const nearbyBoards = new Set(
            state.circuit.boards
                .filter(b => world.x >= b.x - PITCH && world.x <= b.x + BOARD_WIDTH + PITCH
                    && world.y >= b.y - PITCH && world.y <= b.y + BOARD_HEIGHT + PITCH)
                .map(b => b.uid)
        );
        if (nearbyBoards.size === 0) return null;

        // Topmost first, so later components win where they overlap.
        const components = state.circuit.components;
        for (let i = components.length - 1; i >= 0; i--) {
            const component = components[i];
            const boardUid = component.anchor ? component.anchor.board
                : (component.props ? component.props.board : null);
            if (boardUid !== null && boardUid !== undefined && !nearbyBoards.has(boardUid)) continue;
            if (pointInRect(world.x, world.y, componentBounds(component, state.boards))) {
                return component;
            }
        }
        return null;
    }

    /** Which DIP switch lever (1..8) is under a world point, or 0. */
    function switchAt(component, world) {
        if (component.type !== 'dipSwitch8') return 0;
        const pins = componentPinHoles(component);
        let best = 0;
        let bestDistance = PITCH * 0.6;
        for (let k = 0; k < 8; k++) {
            const hole = pins[k] && pins[k].hole;
            if (!hole) continue;
            const point = holeWorldPos(hole, state.boards);
            if (!point) continue;
            const distance = Math.abs(point.x - world.x);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = k + 1;
            }
        }
        return best;
    }

    function ghostFor(hole) {
        if (tool.kind !== 'place' || hole === null) return null;
        const def = getComponentDef(tool.type);
        if (def === null) return null;

        let anchor = hole;
        // DIP-style packages must straddle the channel, so snap onto the nearest of
        // rows e/f rather than refusing every other row.
        if (def.dipStyle && hole.kind === 'main') {
            anchor = Object.assign({}, hole, { row: channelSideRow(hole) });
        }
        const component = state.buildComponent(tool.type, anchor, ghostExtraProps(hole));
        if (component === null) return null;
        const pins = componentPinHoles(component);
        const valid = pins.length > 0 && pins.every(p => p.hole !== null);
        return { component, valid, anchor };
    }

    function ghostExtraProps(hole) {
        if (tool.type === 'powerSupply5V' && hole) {
            return { board: hole.board, side: hole.kind === 'rail' ? (hole.rail.startsWith('top') ? 'top' : 'bottom') : 'top' };
        }
        if (tool.type === 'resistor' && hole) {
            // Second terminal defaults four columns along, which the user then edits.
            const to = Object.assign({}, hole);
            if (to.kind === 'main') to.col = Math.min(63, to.col + 4);
            else to.index = Math.min(50, to.index + 4);
            return { to };
        }
        return undefined;
    }

    function publishScene(...layers) {
        const ghost = tool.kind === 'place' ? ghostFor(hoverHole) : null;
        renderer.setScene({
            circuit: state.circuit,
            boards: state.boards,
            selection: state.selection,
            hoverHole,
            hoverStripPoints: hoverHole
                ? holesInStrip(hoverHole).map(h => holeWorldPos(h, state.boards)).filter(Boolean)
                : null,
            ghost,
            pendingWire: gesture && gesture.kind === 'wire'
                ? { from: gesture.from, toPoint: gesture.toPoint, color: wireColor }
                : null,
            pressed: state.pressed
        }, ...(layers.length > 0 ? layers : ['overlay']));
        if (onSceneChange) onSceneChange();
    }

    // --- Gesture handlers ---

    function beginPan(event) {
        const point = screenPoint(event);
        gesture = { kind: 'pan', lastX: point.x, lastY: point.y };
        canvas.style.cursor = 'grabbing';
    }

    function tryPlace(hole) {
        const ghost = ghostFor(hole);
        if (ghost === null) return;
        if (!ghost.valid) {
            status.warn(`A ${getComponentDef(tool.type).label} does not fit there.`);
            return;
        }
        const result = state.addComponent(tool.type, ghost.component.anchor, ghostExtraProps(hole));
        if (!result.ok) {
            status.warn(result.reason);
            return;
        }
        for (const warning of result.warnings || []) status.warn(warning);
        status.info(`Placed ${getComponentDef(tool.type).label}.`);
    }

    function onPointerDown(event) {
        if (event.button !== 0 && event.button !== 1) return;
        canvas.focus();
        const world = worldPoint(event);
        const screen = screenPoint(event);

        if (event.button === 1 || spaceHeld) {
            beginPan(event);
            event.preventDefault();
            return;
        }

        const hole = holeAt(world);

        if (tool.kind === 'place') {
            tryPlace(hole);
            return;
        }

        if (tool.kind === 'wire') {
            if (hole === null) {
                beginPan(event);
                return;
            }
            gesture = { kind: 'wire', from: hole, toPoint: world };
            publishScene();
            return;
        }

        // --- select mode ---
        const component = componentAt(world);

        // Interactive parts respond to a plain click, so the user can drive the
        // simulation without switching tools.
        if (component) {
            if (component.type === 'pushButton') {
                gesture = { kind: 'button', uid: component.uid };
                state.setPressed(component.uid, true);
                sim.setButton(component.uid, true);
                publishScene('dynamic', 'overlay');
                return;
            }
            if (component.type === 'dipSwitch8') {
                const switchNumber = switchAt(component, world);
                if (switchNumber > 0) {
                    const on = state.toggleSwitch(component.uid, switchNumber);
                    if (on !== null) {
                        sim.setSwitch(component.uid, switchNumber, on);
                        status.info(`Switch ${switchNumber} ${on ? 'on' : 'off'}.`);
                    }
                    return;
                }
            }
            state.select(component.uid, event.shiftKey);
            if (onSelectionChange) onSelectionChange();
            const def = getComponentDef(component.type);
            gesture = {
                kind: 'maybeMove',
                uid: component.uid,
                movable: !def.anchorless,
                startX: screen.x,
                startY: screen.y
            };
            return;
        }

        const wire = hole ? state.wireAtHole(hole) : null;
        if (wire) {
            state.select(wire.uid, event.shiftKey);
            if (onSelectionChange) onSelectionChange();
            publishScene();
            return;
        }

        if (!event.shiftKey) {
            state.clearSelection();
            if (onSelectionChange) onSelectionChange();
        }
        beginPan(event);
    }

    function onPointerMove(event) {
        const world = worldPoint(event);
        const screen = screenPoint(event);

        if (gesture && gesture.kind === 'pan') {
            viewport.panBy(screen.x - gesture.lastX, screen.y - gesture.lastY);
            gesture.lastX = screen.x;
            gesture.lastY = screen.y;
            renderer.viewportChanged();
            return;
        }

        if (gesture && gesture.kind === 'wire') {
            gesture.toPoint = world;
            const hole = holeAt(world);
            // Snap the preview onto a hole when one is near.
            if (hole !== null) {
                const snapped = holeWorldPos(hole, state.boards);
                if (snapped) gesture.toPoint = snapped;
            }
            hoverHole = hole;
            publishScene();
            return;
        }

        if (gesture && gesture.kind === 'maybeMove') {
            const travelled = Math.hypot(screen.x - gesture.startX, screen.y - gesture.startY);
            if (travelled > DRAG_THRESHOLD && gesture.movable) {
                gesture = { kind: 'move', uid: gesture.uid };
            } else {
                return;
            }
        }

        if (gesture && gesture.kind === 'move') {
            const hole = holeAt(world);
            if (hole !== null) {
                const component = state.circuit.components.find(c => c.uid === gesture.uid);
                if (component) {
                    const def = getComponentDef(component.type);
                    let anchor = hole;
                    if (def.dipStyle && hole.kind === 'main') {
                        anchor = Object.assign({}, hole, { row: channelSideRow(hole) });
                    }
                    if (!sameHole(component.anchor, anchor)) state.moveComponent(gesture.uid, anchor);
                }
            }
            return;
        }

        if (gesture && gesture.kind === 'button') return;

        // Idle hover. pointermove is bound to `window` so a drag that leaves the canvas
        // keeps tracking - but that also means this fires for every mouse move anywhere
        // on the page. Hit-testing is O(components), so bail out before doing any of it
        // when the pointer is not actually over the canvas.
        if (!isOverCanvas(event)) {
            if (hoverHole !== null || hoverComponentUid !== null) {
                hoverHole = null;
                hoverComponentUid = null;
                publishScene();
            }
            return;
        }

        const hole = holeAt(world);
        const component = componentAt(world);
        const componentUid = component ? component.uid : null;
        const holeChanged = (hole === null) !== (hoverHole === null)
            || (hole !== null && hoverHole !== null && !sameHole(hole, hoverHole));
        if (!holeChanged && componentUid === hoverComponentUid) return;

        hoverHole = hole;
        hoverComponentUid = componentUid;
        canvas.style.cursor = cursorFor(hole, component);
        publishScene();
    }

    function cursorFor(hole, component) {
        if (spaceHeld) return 'grab';
        if (tool.kind === 'place') return 'copy';
        if (tool.kind === 'wire') return hole ? 'crosshair' : 'default';
        if (component) {
            if (component.type === 'pushButton' || component.type === 'dipSwitch8') return 'pointer';
            return 'move';
        }
        return 'default';
    }

    function onPointerUp(event) {
        if (!gesture) return;

        if (gesture.kind === 'wire') {
            const hole = holeAt(worldPoint(event));
            if (hole !== null && !sameHole(hole, gesture.from)) {
                const result = state.addWire(gesture.from, hole, wireColor);
                if (!result.ok) status.warn(result.reason);
            }
        } else if (gesture.kind === 'button') {
            state.setPressed(gesture.uid, false);
            sim.setButton(gesture.uid, false);
        }

        const wasPan = gesture.kind === 'pan';
        gesture = null;
        canvas.style.cursor = wasPan ? 'default' : canvas.style.cursor;
        publishScene('dynamic', 'overlay');
    }

    function onPointerLeave() {
        if (hoverHole === null && hoverComponentUid === null) return;
        hoverHole = null;
        hoverComponentUid = null;
        publishScene();
    }

    /** Wheel delta in pixels, whatever unit the browser reported it in. */
    function wheelDeltaPixels(event) {
        if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_PX;
        if (event.deltaMode === 2) {
            return event.deltaY * (canvas.clientHeight || WHEEL_PAGE_FALLBACK_PX);
        }
        return event.deltaY;
    }

    function onWheel(event) {
        event.preventDefault();
        const point = screenPoint(event);
        viewport.zoomByWheel(point.x, point.y, wheelDeltaPixels(event));
        renderer.viewportChanged();
        if (onSceneChange) onSceneChange();
    }

    function onKeyDown(event) {
        if (event.key === ' ' && !spaceHeld) {
            spaceHeld = true;
            canvas.style.cursor = 'grab';
            event.preventDefault();
            return;
        }
        if (event.key === 'Escape') {
            if (gesture && gesture.kind === 'wire') {
                gesture = null;
                status.info('Wire cancelled.');
            } else if (tool.kind !== 'select') {
                options.setTool({ kind: 'select', type: null });
            } else {
                state.clearSelection();
                if (onSelectionChange) onSelectionChange();
            }
            publishScene();
            return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            const removed = state.deleteSelected();
            if (removed > 0) {
                status.info(`Deleted ${removed} item${removed === 1 ? '' : 's'}.`);
                if (onSelectionChange) onSelectionChange();
            }
            event.preventDefault();
            return;
        }
        if (event.key === 'r' || event.key === 'R') {
            for (const uid of [...state.selection]) {
                const result = state.rotateComponent(uid);
                if (!result.ok && result.reason) status.warn(result.reason);
            }
            return;
        }
        if (event.key === '+' || event.key === '=') {
            viewport.zoomAtCenter(renderer.width, renderer.height, 1.2);
            renderer.viewportChanged();
        } else if (event.key === '-' || event.key === '_') {
            viewport.zoomAtCenter(renderer.width, renderer.height, 1 / 1.2);
            renderer.viewportChanged();
        }
    }

    function onKeyUp(event) {
        if (event.key === ' ') {
            spaceHeld = false;
            canvas.style.cursor = 'default';
        }
    }

    bag.on(canvas, 'pointerdown', onPointerDown);
    bag.on(window, 'pointermove', onPointerMove);
    bag.on(window, 'pointerup', onPointerUp);
    bag.on(canvas, 'pointerleave', onPointerLeave);
    bag.on(canvas, 'wheel', onWheel, { passive: false });
    bag.on(canvas, 'keydown', onKeyDown);
    bag.on(canvas, 'keyup', onKeyUp);
    bag.on(canvas, 'contextmenu', e => e.preventDefault());

    return {
        get tool() { return tool; },
        setTool(next) {
            tool = next;
            gesture = null;
            canvas.style.cursor = cursorFor(hoverHole, null);
            publishScene();
        },
        get wireColor() { return wireColor; },
        setWireColor(color) {
            wireColor = color;
            for (const uid of [...state.selection]) state.setWireColor(uid, color);
            publishScene('dynamic', 'overlay');
        },
        refresh: publishScene,
        destroy() {
            bag.removeAll();
        }
    };
}
