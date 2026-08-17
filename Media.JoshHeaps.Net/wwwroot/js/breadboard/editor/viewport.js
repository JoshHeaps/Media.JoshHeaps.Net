// Pan / zoom state and the conversions between coordinate spaces.
//
// THREE SPACES, and every function here is named for the one it works in:
//   screen space - CSS pixels relative to the canvas element's top-left. This is what
//                  mouse events give us (after subtracting the bounding rect).
//   world space  - the shared coordinate system all boards live in. board.x/board.y
//                  and board-geometry's world positions are in this space.
//   board space  - a single board's own frame. board-geometry owns it; nothing here
//                  touches it.
//
// The mapping is:  screen = world * zoom + offset
//                  world  = (screen - offset) / zoom
//
// devicePixelRatio is deliberately NOT part of this. It is a property of the canvas
// backing store, applied by the renderer as the base transform before the world
// transform, so every number in this file is in CSS pixels. See renderer.js.

/** Zoom limits. Below MIN a board is a few pixels tall; above MAX holes are huge. */
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 6;

const ZOOM_STEP = 1.0015;      // per unit of wheel deltaY

export function createViewport() {
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;

    function clampZoom(value) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }

    return {
        get zoom() { return zoom; },
        get offsetX() { return offsetX; },
        get offsetY() { return offsetY; },

        /** Screen point (CSS px, canvas-relative) -> world point. */
        screenToWorld(screenX, screenY) {
            return { x: (screenX - offsetX) / zoom, y: (screenY - offsetY) / zoom };
        },

        /** World point -> screen point (CSS px, canvas-relative). */
        worldToScreen(worldX, worldY) {
            return { x: worldX * zoom + offsetX, y: worldY * zoom + offsetY };
        },

        /** Convert a screen-space distance to world units. */
        screenToWorldDistance(distance) {
            return distance / zoom;
        },

        /** Move the view by a screen-space delta (a drag). */
        panBy(screenDX, screenDY) {
            offsetX += screenDX;
            offsetY += screenDY;
        },

        /**
         * Zoom about a fixed screen point, so the world point under the cursor stays
         * put. This is the whole trick to a wheel zoom that feels right.
         */
        zoomAt(screenX, screenY, factor) {
            const next = clampZoom(zoom * factor);
            if (next === zoom) return;
            const worldX = (screenX - offsetX) / zoom;
            const worldY = (screenY - offsetY) / zoom;
            zoom = next;
            offsetX = screenX - worldX * zoom;
            offsetY = screenY - worldY * zoom;
        },

        /** Wheel handler helper: converts a wheel delta into a zoom factor. */
        zoomByWheel(screenX, screenY, deltaY) {
            this.zoomAt(screenX, screenY, Math.pow(ZOOM_STEP, -deltaY));
        },

        /** Zoom about the centre of a viewport of the given CSS-pixel size. */
        zoomAtCenter(width, height, factor) {
            this.zoomAt(width / 2, height / 2, factor);
        },

        /** Set zoom directly, keeping the viewport centre fixed. */
        setZoom(value, width, height) {
            const next = clampZoom(value);
            this.zoomAt(width / 2, height / 2, next / zoom);
        },

        /**
         * Frame a world-space rect in a viewport of the given CSS-pixel size.
         * @param {{x:number,y:number,w:number,h:number}} bounds
         */
        fit(bounds, width, height, padding = 40) {
            if (width <= 0 || height <= 0 || bounds.w <= 0 || bounds.h <= 0) return;
            const scale = Math.min(
                (width - padding * 2) / bounds.w,
                (height - padding * 2) / bounds.h
            );
            zoom = clampZoom(scale);
            offsetX = width / 2 - (bounds.x + bounds.w / 2) * zoom;
            offsetY = height / 2 - (bounds.y + bounds.h / 2) * zoom;
        },

        /** World-space rect currently visible in a viewport of the given size. */
        visibleWorldRect(width, height) {
            const topLeft = this.screenToWorld(0, 0);
            const bottomRight = this.screenToWorld(width, height);
            return {
                x: topLeft.x,
                y: topLeft.y,
                w: bottomRight.x - topLeft.x,
                h: bottomRight.y - topLeft.y
            };
        },

        /** Serializable state, for persisting the view between sessions. */
        toJSON() {
            return { zoom, offsetX, offsetY };
        },

        /** Restore from toJSON(). Ignores anything malformed. */
        restore(state) {
            if (!state || typeof state !== 'object') return false;
            if (![state.zoom, state.offsetX, state.offsetY].every(Number.isFinite)) return false;
            zoom = clampZoom(state.zoom);
            offsetX = state.offsetX;
            offsetY = state.offsetY;
            return true;
        }
    };
}

/** True when two world-space rects overlap - used to cull off-screen boards. */
export function rectsIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
