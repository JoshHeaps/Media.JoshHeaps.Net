// Layered canvas renderer.
//
// ============================ COORDINATE / SCALE POLICY ============================
// devicePixelRatio lives OUTSIDE the world transform, and this is the only file that
// knows about it. Each canvas backing store is sized cssPx * dpr; before drawing we
// set the BASE transform to (dpr, 0, 0, dpr, 0, 0), then apply the pan/zoom world
// transform on top of it. Consequences, relied on everywhere else:
//   - viewport.js, board-geometry.js and component-art.js never see device pixels.
//   - a "line width of 2" is 2 CSS pixels at zoom 1, on every display.
//   - hit-testing uses viewport.screenToWorld on CSS-pixel mouse coordinates, with no
//     dpr correction anywhere.
//
// ================================ LAYERS & DIRTYING ================================
// Four stacked canvases, each redrawn only when something it depends on changes.
//
//   board    static board artwork, blitted from a cached bitmap (board-art.js).
//            Dirty on: board add/move/remove, theme, viewport.
//   static   components whose appearance CANNOT change during simulation - chips,
//            resistors, supplies. These carry the expensive text.
//            Dirty on: circuit edit, theme, viewport.
//   dynamic  wires (with net-level halos) and the components that DO change - LEDs,
//            buttons, DIP switches.
//            Dirty on: circuit edit, theme, viewport, and every simulation frame.
//   overlay  hover highlight, selection, drag ghost, in-progress wire.
//            Dirty on: pointer/selection changes only.
//
// Each component is drawn on exactly one layer, chosen by whether simulation can alter
// it, so a 60 fps frame never re-rasterizes chip labels and a mousemove that changes
// nothing draws nothing.

import {
    PITCH,
    BOARD_WIDTH,
    BOARD_HEIGHT,
    holeWorldPos,
    boardBounds,
    stripKey
} from '../shared/board-geometry.js';

import { createBoardArtCache } from './board-art.js';
import { drawComponent, drawWire, componentBounds } from './component-art.js';
import { rectsIntersect } from './viewport.js';

/** Components whose drawn appearance depends on simulation state. */
const VOLATILE_TYPES = new Set(['led', 'pushButton', 'dipSwitch8']);

const LAYER_NAMES = Object.freeze(['board', 'static', 'dynamic', 'overlay']);

export function createRenderer(container, viewport, palette, options = {}) {
    const canvases = {};
    const contexts = {};
    const boardArt = createBoardArtCache();

    for (const name of LAYER_NAMES) {
        const canvas = document.createElement('canvas');
        canvas.className = `bb-layer bb-layer-${name}`;
        // Only the topmost layer takes pointer events; the rest are pure paint.
        canvas.style.pointerEvents = name === 'overlay' ? 'auto' : 'none';
        container.appendChild(canvas);
        canvases[name] = canvas;
        contexts[name] = canvas.getContext('2d');
    }
    canvases.overlay.tabIndex = 0;      // focusable, so the canvas can own keyboard

    // Latest MEASURED size, in CSS pixels. Read straight after resize() so callers
    // that fit the view can trust it.
    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    // Size the backing stores currently hold. Reallocating them costs tens of MB of
    // churn, so it happens once per frame at most, inside paint().
    let appliedWidth = 0;
    let appliedHeight = 0;
    let appliedDpr = 0;
    const dirty = { board: true, static: true, dynamic: true, overlay: true };
    let frameHandle = null;

    // Latest scene to draw. Replaced wholesale by the editor on each change.
    let scene = {
        circuit: null,
        boards: new Map(),
        selection: new Set(),
        hoverHole: null,
        hoverComponent: null,
        pendingWire: null,       // { from: holeRef, toPoint: {x,y}, color }
        ghost: null,             // { component, valid }
        ledBrightness: new Map(),
        burned: new Set(),
        pressed: new Set(),
        warnedUids: new Set(),   // components a simulation warning named
        netLevels: null,         // Uint8Array
        netOfStrip: null,        // Map<stripKey, netId>
        simActive: false
    };

    /** Read the container size. Cheap - one layout read, no canvas work. */
    function measureContainer() {
        const rect = container.getBoundingClientRect();
        const nextDpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (width === cssWidth && height === cssHeight && nextDpr === dpr) return false;
        cssWidth = width;
        cssHeight = height;
        dpr = nextDpr;
        return true;
    }

    /** Resize the backing stores to the measured size. Wipes them, so all layers dirty. */
    function applyCanvasSize() {
        if (cssWidth === appliedWidth && cssHeight === appliedHeight && dpr === appliedDpr) return;
        appliedWidth = cssWidth;
        appliedHeight = cssHeight;
        appliedDpr = dpr;
        for (const name of LAYER_NAMES) {
            const canvas = canvases[name];
            canvas.width = Math.round(cssWidth * dpr);
            canvas.height = Math.round(cssHeight * dpr);
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
        }
        for (const name of LAYER_NAMES) dirty[name] = true;
    }

    /** Apply the base dpr transform, then the world transform. */
    function beginWorld(ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.save();
        ctx.translate(viewport.offsetX, viewport.offsetY);
        ctx.scale(viewport.zoom, viewport.zoom);
    }

    function endWorld(ctx) {
        ctx.restore();
    }

    function visibleRect() {
        const rect = viewport.visibleWorldRect(cssWidth, cssHeight);
        // A little margin so components straddling the edge are not clipped mid-body.
        const margin = PITCH * 4;
        return { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
    }

    function visibleBoards(view) {
        if (!scene.circuit) return [];
        return scene.circuit.boards.filter(board => rectsIntersect(boardBounds(board), view));
    }

    // --- Layer painters ---

    function drawBoardLayer() {
        const ctx = contexts.board;
        beginWorld(ctx);
        if (scene.circuit) {
            const art = boardArt.get(viewport.zoom, palette.colors, palette.version);
            const view = visibleRect();
            for (const board of visibleBoards(view)) {
                ctx.drawImage(art.surface, board.x, board.y, BOARD_WIDTH, BOARD_HEIGHT);
            }
        }
        endWorld(ctx);
    }

    /** Net level code for a hole, or -1 when the simulation has nothing to say. */
    function levelAtHole(hole) {
        if (!scene.netLevels || !scene.netOfStrip || !hole) return -1;
        const netId = scene.netOfStrip.get(stripKey(hole));
        if (netId === undefined || netId < 0 || netId >= scene.netLevels.length) return -1;
        return scene.netLevels[netId];
    }

    function drawStaticLayer() {
        const ctx = contexts.static;
        beginWorld(ctx);
        if (scene.circuit) {
            const view = visibleRect();
            for (const component of scene.circuit.components) {
                if (VOLATILE_TYPES.has(component.type)) continue;
                const bounds = componentBounds(component, scene.boards);
                if (bounds === null || !rectsIntersect(bounds, view)) continue;
                drawComponent(ctx, component, scene.boards, palette.colors, {}, viewport.zoom);
            }
        }
        endWorld(ctx);
    }

    function drawDynamicLayer() {
        const ctx = contexts.dynamic;
        beginWorld(ctx);
        if (scene.circuit) {
            const view = visibleRect();

            for (const wire of scene.circuit.wires) {
                const from = holeWorldPos(wire.from, scene.boards);
                const to = holeWorldPos(wire.to, scene.boards);
                if (!from || !to) continue;
                const bounds = {
                    x: Math.min(from.x, to.x) - PITCH,
                    y: Math.min(from.y, to.y) - PITCH,
                    w: Math.abs(to.x - from.x) + PITCH * 2,
                    h: Math.abs(to.y - from.y) + PITCH * 2
                };
                if (!rectsIntersect(bounds, view)) continue;

                let levelColor = null;
                if (scene.simActive) {
                    const level = levelAtHole(wire.from);
                    if (level >= 0) levelColor = palette.levelColor(level);
                }
                drawWire(ctx, from, to, wire.color, {
                    levelColor,
                    shadow: palette.colors.wireShadow
                });
            }

            for (const component of scene.circuit.components) {
                if (!VOLATILE_TYPES.has(component.type)) continue;
                const bounds = componentBounds(component, scene.boards);
                if (bounds === null || !rectsIntersect(bounds, view)) continue;
                drawComponent(ctx, component, scene.boards, palette.colors, {
                    brightness: scene.ledBrightness.get(component.uid) || 0,
                    burned: scene.burned.has(component.uid),
                    pressed: scene.pressed.has(component.uid)
                }, viewport.zoom);
            }
        }
        endWorld(ctx);
    }

    function drawOverlayLayer() {
        const ctx = contexts.overlay;
        beginWorld(ctx);
        const colors = palette.colors;

        // Selection rings around every selected component's pins.
        for (const uid of scene.selection) {
            const component = scene.circuit && scene.circuit.components.find(c => c.uid === uid);
            if (component) {
                const bounds = componentBounds(component, scene.boards);
                if (bounds) {
                    ctx.strokeStyle = colors.selection;
                    ctx.lineWidth = Math.max(1.5 / viewport.zoom, PITCH * 0.07);
                    ctx.setLineDash([PITCH * 0.3, PITCH * 0.2]);
                    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
                    ctx.setLineDash([]);
                }
                continue;
            }
            const wire = scene.circuit && scene.circuit.wires.find(w => w.uid === uid);
            if (wire) {
                const from = holeWorldPos(wire.from, scene.boards);
                const to = holeWorldPos(wire.to, scene.boards);
                if (from && to) {
                    ctx.strokeStyle = colors.selection;
                    ctx.lineWidth = PITCH * 0.34;
                    ctx.globalAlpha = 0.45;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(from.x, from.y);
                    ctx.lineTo(to.x, to.y);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }
        }

        // Components a warning named. Worth drawing rather than only listing: the
        // whole difficulty with a self-shorted or burned-out part is that it looks
        // correctly placed, so a text row alone leaves the user hunting for it.
        if (scene.warnedUids && scene.warnedUids.size > 0 && scene.circuit) {
            ctx.strokeStyle = colors.invalid;
            ctx.lineWidth = Math.max(2 / viewport.zoom, PITCH * 0.09);
            ctx.setLineDash([PITCH * 0.22, PITCH * 0.18]);
            for (const uid of scene.warnedUids) {
                const component = scene.circuit.components.find(c => c.uid === uid);
                if (!component) continue;
                const bounds = componentBounds(component, scene.boards);
                if (bounds === null) continue;
                const pad = PITCH * 0.18;
                ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
            }
            ctx.setLineDash([]);
        }

        // Ghost of the component about to be placed.
        if (scene.ghost && scene.ghost.component) {
            ctx.globalAlpha = 0.55;
            drawComponent(ctx, scene.ghost.component, scene.boards, colors, {}, viewport.zoom);
            ctx.globalAlpha = 1;
            if (!scene.ghost.valid) {
                const bounds = componentBounds(scene.ghost.component, scene.boards);
                if (bounds) {
                    ctx.strokeStyle = colors.invalid;
                    ctx.lineWidth = Math.max(1.5 / viewport.zoom, PITCH * 0.08);
                    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
                }
            }
        }

        // Wire being dragged out.
        if (scene.pendingWire) {
            const from = holeWorldPos(scene.pendingWire.from, scene.boards);
            if (from && scene.pendingWire.toPoint) {
                ctx.strokeStyle = scene.pendingWire.color;
                ctx.lineWidth = PITCH * 0.18;
                ctx.globalAlpha = 0.85;
                ctx.setLineDash([PITCH * 0.4, PITCH * 0.25]);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(scene.pendingWire.toPoint.x, scene.pendingWire.toPoint.y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
            }
        }

        // Hovered hole, plus a soft wash over every other hole on the same strip so the
        // electrical grouping is visible while wiring.
        if (scene.hoverHole) {
            const point = holeWorldPos(scene.hoverHole, scene.boards);
            if (point) {
                if (scene.hoverStripPoints) {
                    ctx.fillStyle = colors.hover;
                    ctx.globalAlpha = 0.18;
                    for (const p of scene.hoverStripPoints) {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, PITCH * 0.3, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;
                }
                ctx.strokeStyle = colors.hover;
                ctx.lineWidth = Math.max(1.5 / viewport.zoom, PITCH * 0.08);
                ctx.beginPath();
                ctx.arc(point.x, point.y, PITCH * 0.34, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        endWorld(ctx);
    }

    const PAINTERS = { board: drawBoardLayer, static: drawStaticLayer, dynamic: drawDynamicLayer, overlay: drawOverlayLayer };

    // Layers whose painter has already thrown, so the failure is reported once rather
    // than on every frame.
    const reportedFailures = new Set();

    function paint() {
        frameHandle = null;
        applyCanvasSize();
        for (const name of LAYER_NAMES) {
            if (!dirty[name]) continue;
            try {
                PAINTERS[name]();
                // Cleared only on success. Marking clean before painting would leave a
                // layer that threw permanently stale, so it could never recover even
                // once the cause was gone.
                dirty[name] = false;
            } catch (error) {
                if (!reportedFailures.has(name)) {
                    reportedFailures.add(name);
                    const message = error && error.message ? error.message : String(error);
                    if (typeof options.onPaintError === 'function') {
                        options.onPaintError(name, message);
                    }
                }
                // Stop rather than cascade: the layers below would paint over a gap.
                break;
            }
        }
    }

    function schedule() {
        if (frameHandle === null) frameHandle = requestAnimationFrame(paint);
    }

    function invalidate(...names) {
        for (const name of names) dirty[name] = true;
        schedule();
    }

    function invalidateAll() {
        invalidate(...LAYER_NAMES);
    }

    const unsubscribeTheme = palette.subscribe(() => {
        boardArt.invalidate();
        invalidateAll();
    });

    return {
        get canvas() { return canvases.overlay; },
        get width() { return cssWidth; },
        get height() { return cssHeight; },

        /** Replace the scene and mark the given layers dirty. */
        setScene(next, ...invalidated) {
            scene = Object.assign(scene, next);
            invalidate(...(invalidated.length > 0 ? invalidated : LAYER_NAMES));
        },

        resize() {
            if (measureContainer()) invalidateAll();
        },

        invalidate,
        invalidateAll,

        /** Board artwork must be re-rasterized when the zoom bucket may have changed. */
        viewportChanged() {
            invalidate('board', 'static', 'dynamic', 'overlay');
        },

        destroy() {
            if (frameHandle !== null) cancelAnimationFrame(frameHandle);
            frameHandle = null;
            unsubscribeTheme();
            boardArt.invalidate();
            for (const name of LAYER_NAMES) {
                const canvas = canvases[name];
                if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            }
        }
    };
}
