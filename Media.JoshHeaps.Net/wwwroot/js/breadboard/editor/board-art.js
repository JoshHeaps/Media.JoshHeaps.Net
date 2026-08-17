// Static breadboard artwork, rasterized once and blitted.
//
// A board's face, holes, rails and silkscreen never change, so redrawing 830 holes per
// frame per board would be pure waste. This rasterizes ONE board bitmap and blits it
// for every board on the canvas - every board is visually identical, so the cache is a
// single image no matter how many boards the circuit has.
//
// CACHING POLICY (stated explicitly, since silence here is a bug waiting to happen):
// the bitmap is rasterized at a QUANTIZED scale, not at the exact zoom. Buckets are
// powers of two and we pick the smallest bucket at or above the current zoom, so a
// wheel gesture re-rasterizes at most a handful of times instead of on every tick. The
// cache is keyed by (scale bucket, palette version), so a theme change invalidates it.
//
// UP TO bucket 4 the blit only ever scales DOWN, which stays sharp. ABOVE it the art is
// magnified - viewport MAX_ZOOM is 6, so zoom 4-6 blits at up to 1.5x and the board
// looks mildly soft there. That is DELIBERATE, to bound memory: the bucket-4 bitmap is
// already 5120x1600 px, about 33 MB, and a bucket 8 would be ~131 MB. Slightly soft
// artwork at extreme zoom is the better trade. Note the 33 MB is allocated as soon as a
// user zooms past 2, and it is one bitmap total - every board blits from the same one.

import {
    PITCH,
    BOARD_COLUMNS,
    BOARD_WIDTH,
    BOARD_HEIGHT,
    RAIL_HOLES,
    MAIN_ROWS,
    RAIL_NAMES,
    CHANNEL_TOP,
    CHANNEL_BOTTOM,
    columnX,
    rowY,
    railHoleX,
    railY
} from '../shared/board-geometry.js';

const SCALE_BUCKETS = Object.freeze([0.25, 0.5, 1, 2, 4]);

/**
 * Smallest bucket at or above `zoom`. Below the top bucket the blit scales down; above
 * it there is nothing sharper to pick, so the art is magnified. See the memory note at
 * the top of this file for why the ladder stops at 4.
 */
export function scaleBucketFor(zoom) {
    for (const bucket of SCALE_BUCKETS) {
        if (zoom <= bucket) return bucket;
    }
    return SCALE_BUCKETS[SCALE_BUCKETS.length - 1];
}

function createSurface(width, height) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * Draw one board at 1:1 board-space scale. The caller has already applied the bucket
 * scale to the context, so everything here is in board-space units.
 */
function paintBoard(ctx, colors) {
    // Face
    ctx.fillStyle = colors.boardFace;
    roundRect(ctx, 0, 0, BOARD_WIDTH, BOARD_HEIGHT, PITCH * 0.4);
    ctx.fill();

    // A soft bevel along the top edge reads as moulded plastic without costing much.
    const bevel = ctx.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
    bevel.addColorStop(0, colors.boardBevel);
    bevel.addColorStop(0.06, colors.boardFace);
    bevel.addColorStop(0.94, colors.boardFace);
    bevel.addColorStop(1, colors.boardEdge);
    ctx.fillStyle = bevel;
    ctx.globalAlpha = 0.55;
    roundRect(ctx, 0, 0, BOARD_WIDTH, BOARD_HEIGHT, PITCH * 0.4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = colors.boardEdge;
    ctx.lineWidth = 1;
    roundRect(ctx, 0.5, 0.5, BOARD_WIDTH - 1, BOARD_HEIGHT - 1, PITCH * 0.4);
    ctx.stroke();

    paintChannel(ctx, colors);
    paintRailMarkings(ctx, colors);
    paintHoles(ctx, colors);
    paintSilkscreen(ctx, colors);
}

function paintChannel(ctx, colors) {
    const height = CHANNEL_BOTTOM - CHANNEL_TOP;
    const gradient = ctx.createLinearGradient(0, CHANNEL_TOP, 0, CHANNEL_BOTTOM);
    gradient.addColorStop(0, colors.channelEdge);
    gradient.addColorStop(0.35, colors.channel);
    gradient.addColorStop(1, colors.channelEdge);
    ctx.fillStyle = gradient;
    ctx.fillRect(PITCH * 0.5, CHANNEL_TOP, BOARD_WIDTH - PITCH, height);

    ctx.strokeStyle = colors.channelEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PITCH * 0.5, CHANNEL_TOP + 0.5);
    ctx.lineTo(BOARD_WIDTH - PITCH * 0.5, CHANNEL_TOP + 0.5);
    ctx.moveTo(PITCH * 0.5, CHANNEL_BOTTOM - 0.5);
    ctx.lineTo(BOARD_WIDTH - PITCH * 0.5, CHANNEL_BOTTOM - 0.5);
    ctx.stroke();
}

/** The red/blue guide lines that run alongside each power rail. */
function paintRailMarkings(ctx, colors) {
    const x0 = railHoleX(1) - PITCH * 0.7;
    const x1 = railHoleX(RAIL_HOLES) + PITCH * 0.7;

    for (const rail of RAIL_NAMES) {
        const isPlus = rail.endsWith('Plus');
        const y = railY(rail);
        // The stripe sits on the outer side of its rail, as on a real board.
        const outward = (rail === 'topPlus' || rail === 'bottomMinus') ? -1 : 1;
        const lineY = y + outward * PITCH * 0.62;

        ctx.strokeStyle = isPlus ? colors.railPlus : colors.railMinus;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = Math.max(1, PITCH * 0.08);
        ctx.beginPath();
        ctx.moveTo(x0, lineY);
        ctx.lineTo(x1, lineY);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // + and - symbols at both ends
        ctx.fillStyle = isPlus ? colors.railPlus : colors.railMinus;
        for (const x of [x0 - PITCH * 0.55, x1 + PITCH * 0.55]) {
            const arm = PITCH * 0.22;
            ctx.lineWidth = Math.max(1, PITCH * 0.09);
            ctx.strokeStyle = ctx.fillStyle;
            ctx.beginPath();
            ctx.moveTo(x - arm, lineY);
            ctx.lineTo(x + arm, lineY);
            if (isPlus) {
                ctx.moveTo(x, lineY - arm);
                ctx.lineTo(x, lineY + arm);
            }
            ctx.stroke();
        }
    }
}

function paintHoles(ctx, colors) {
    const radius = PITCH * 0.17;
    const inset = PITCH * 0.28;

    const drawHole = (x, y) => {
        // Square socket recess, then the round hole - reads as a real breadboard.
        ctx.fillStyle = colors.holeRim;
        ctx.fillRect(x - inset, y - inset, inset * 2, inset * 2);
        ctx.fillStyle = colors.hole;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    };

    for (let col = 1; col <= BOARD_COLUMNS; col++) {
        const x = columnX(col);
        for (const row of MAIN_ROWS) drawHole(x, rowY(row));
    }
    for (const rail of RAIL_NAMES) {
        const y = railY(rail);
        for (let i = 1; i <= RAIL_HOLES; i++) drawHole(railHoleX(i), y);
    }
}

function paintSilkscreen(ctx, colors) {
    ctx.fillStyle = colors.silk;
    ctx.font = `${Math.round(PITCH * 0.42)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Row letters, just outside the main grid at both ends.
    for (const row of MAIN_ROWS) {
        const y = rowY(row);
        ctx.fillText(row, columnX(1) - PITCH * 0.75, y);
        ctx.fillText(row, columnX(BOARD_COLUMNS) + PITCH * 0.75, y);
    }

    // Column numbers every 5 columns, above row a and below row j.
    ctx.fillStyle = colors.silkStrong;
    ctx.font = `${Math.round(PITCH * 0.38)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (let col = 1; col <= BOARD_COLUMNS; col++) {
        if (col !== 1 && col % 5 !== 0) continue;
        const x = columnX(col);
        ctx.fillText(String(col), x, rowY('a') - PITCH * 0.72);
        ctx.fillText(String(col), x, rowY('j') + PITCH * 0.72);
    }
}

/**
 * Cache of rasterized board bitmaps, keyed by scale bucket and palette version.
 * One entry serves every board in the circuit.
 */
export function createBoardArtCache() {
    let cached = null;      // { bucket, paletteVersion, surface }

    return {
        /**
         * A board bitmap suitable for the given zoom, rasterizing only when the bucket
         * or the theme has changed.
         * @returns {{surface: (OffscreenCanvas|HTMLCanvasElement), bucket: number}}
         */
        get(zoom, colors, paletteVersion) {
            const bucket = scaleBucketFor(zoom);
            if (cached !== null && cached.bucket === bucket && cached.paletteVersion === paletteVersion) {
                return cached;
            }
            const surface = createSurface(
                Math.ceil(BOARD_WIDTH * bucket),
                Math.ceil(BOARD_HEIGHT * bucket)
            );
            const ctx = surface.getContext('2d');
            ctx.save();
            ctx.scale(bucket, bucket);
            paintBoard(ctx, colors);
            ctx.restore();
            cached = { bucket, paletteVersion, surface };
            return cached;
        },
        /** Drop the cached bitmap; the next get() re-rasterizes. */
        invalidate() {
            cached = null;
        }
    };
}
