// Breadboard geometry: hole coordinates and strip connectivity.
//
// PURE MODULE. No DOM, no globals, no dependencies. It is imported by the editor on
// the main thread AND by the simulation engine inside a module Worker, so it must be
// loadable in bare node too. Do not add side effects at import time.
//
// Coordinate spaces used here:
//   board space  - px relative to a board's own top-left corner
//   world space  - board space + the board's {x, y}; pan/zoom is applied on top of
//                  this by the renderer, never in this file
// This file never sees screen/CSS pixels.
//
// Physical model: full-size 830-point breadboard.
//   63 columns; rows a-e and f-j are separate 5-hole terminal strips per column;
//   a center channel between rows e and f; four power rails of 50 holes each, and
//   each rail is ONE continuous net end-to-end (no mid-board split) for v1.

/** World px between adjacent holes (one 0.1" pitch). */
export const PITCH = 20;

/** Number of main-grid columns, numbered 1..BOARD_COLUMNS. */
export const BOARD_COLUMNS = 63;

/** Holes per power rail, numbered 1..RAIL_HOLES. */
export const RAIL_HOLES = 50;

/** Main-grid row letters, ordered top to bottom. */
export const MAIN_ROWS = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

/** Power rail names, ordered top to bottom as they appear on the board. */
export const RAIL_NAMES = Object.freeze(['topPlus', 'topMinus', 'bottomMinus', 'bottomPlus']);

/** Rows above the center channel (one electrical strip per column). */
export const UPPER_ROWS = Object.freeze(['a', 'b', 'c', 'd', 'e']);

/** Rows below the center channel (one electrical strip per column). */
export const LOWER_ROWS = Object.freeze(['f', 'g', 'h', 'i', 'j']);

// --- Board space layout, expressed in pitch units from the board's top-left ---

const MARGIN_COLS = 1;            // blank margin left of column 1
const ROW_Y_PITCH = Object.freeze(Object.assign(Object.create(null), {
    a: 4.5, b: 5.5, c: 6.5, d: 7.5, e: 8.5,
    f: 11.5, g: 12.5, h: 13.5, i: 14.5, j: 15.5
}));
const RAIL_Y_PITCH = Object.freeze(Object.assign(Object.create(null), {
    topPlus: 1, topMinus: 2, bottomMinus: 18, bottomPlus: 19
}));

// Rail holes sit in 10 groups of 5 with a one-pitch gap between groups, and the whole
// run is inset from the main grid - matching a real board. Derived independently of
// the main columns on purpose: rail hole 7 is NOT under column 7.
const RAIL_GROUP_SIZE = 5;
const RAIL_GROUP_STRIDE = 6;      // 5 holes + 1 blank
const RAIL_X0_PITCH = 3;

/** Board width in world px. */
export const BOARD_WIDTH = (BOARD_COLUMNS + 2 * MARGIN_COLS) * PITCH;

/** Board height in world px. */
export const BOARD_HEIGHT = 20 * PITCH;

/** Y of the top of the center channel, in board space. */
export const CHANNEL_TOP = (ROW_Y_PITCH.e + 1) * PITCH;

/** Y of the bottom of the center channel, in board space. */
export const CHANNEL_BOTTOM = (ROW_Y_PITCH.f - 1) * PITCH;

/** How close (world px) a point must be to a hole to count as over it. */
export const HOLE_HIT_RADIUS = PITCH * 0.5;

const MAIN_ROW_INDEX = Object.freeze(
    MAIN_ROWS.reduce((acc, row, i) => { acc[row] = i; return acc; }, Object.create(null))
);

function isPositiveInt(value, max) {
    return Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * Structural validity of a hole reference. Does NOT check that the referenced board
 * exists in a circuit - that is circuit-schema's job.
 * @param {*} hole
 * @returns {boolean}
 */
export function isValidHole(hole) {
    if (!hole || typeof hole !== 'object') return false;
    if (typeof hole.board !== 'string' || hole.board.length === 0) return false;
    if (hole.kind === 'main') {
        return isPositiveInt(hole.col, BOARD_COLUMNS)
            && typeof hole.row === 'string'
            && Object.prototype.hasOwnProperty.call(MAIN_ROW_INDEX, hole.row);
    }
    if (hole.kind === 'rail') {
        return RAIL_NAMES.indexOf(hole.rail) !== -1 && isPositiveInt(hole.index, RAIL_HOLES);
    }
    return false;
}

/**
 * Canonical identity of a single hole.
 *
 * Assumes board uids conform to circuit-schema's UID_PATTERN, which excludes the '|'
 * delimiter. normalizeCircuit enforces that charset, so a uid can never split a key
 * into the wrong number of segments.
 * @returns {string|null} e.g. "b1|m|12|e" or "b1|h|topPlus|7"
 */
export function holeKey(hole) {
    if (!isValidHole(hole)) return null;
    return hole.kind === 'main'
        ? `${hole.board}|m|${hole.col}|${hole.row}`
        : `${hole.board}|h|${hole.rail}|${hole.index}`;
}

/**
 * Canonical identity of the electrically-common strip a hole belongs to. Two holes
 * are directly connected by the board itself iff their stripKeys are equal.
 * @returns {string|null} e.g. "b1|s|12|ae", "b1|s|12|fj", "b1|r|topPlus"
 */
export function stripKey(hole) {
    if (!isValidHole(hole)) return null;
    if (hole.kind === 'rail') return `${hole.board}|r|${hole.rail}`;
    const half = MAIN_ROW_INDEX[hole.row] <= MAIN_ROW_INDEX.e ? 'ae' : 'fj';
    return `${hole.board}|s|${hole.col}|${half}`;
}

/**
 * Inverse of holeKey.
 * @returns {object|null} a hole reference, or null if the key is malformed
 */
export function parseHoleKey(key) {
    if (typeof key !== 'string') return null;
    const parts = key.split('|');
    if (parts.length !== 4) return null;
    const [board, tag, a, b] = parts;
    let hole = null;
    if (tag === 'm') {
        hole = { board, kind: 'main', col: Number(a), row: b };
    } else if (tag === 'h') {
        hole = { board, kind: 'rail', rail: a, index: Number(b) };
    }
    return isValidHole(hole) ? hole : null;
}

/**
 * Every hole on the same strip as the given hole, including the hole itself.
 * @returns {object[]} 5 holes for a main strip, RAIL_HOLES for a rail, [] if invalid
 */
export function holesInStrip(hole) {
    if (!isValidHole(hole)) return [];
    if (hole.kind === 'rail') {
        const holes = [];
        for (let i = 1; i <= RAIL_HOLES; i++) {
            holes.push({ board: hole.board, kind: 'rail', rail: hole.rail, index: i });
        }
        return holes;
    }
    const rows = MAIN_ROW_INDEX[hole.row] <= MAIN_ROW_INDEX.e ? UPPER_ROWS : LOWER_ROWS;
    return rows.map(row => ({ board: hole.board, kind: 'main', col: hole.col, row }));
}

/** True when both holes are valid and share one electrical strip. */
export function sameStrip(a, b) {
    const ka = stripKey(a);
    return ka !== null && ka === stripKey(b);
}

/** True when both holes are valid and are the same physical hole. */
export function sameHole(a, b) {
    const ka = holeKey(a);
    return ka !== null && ka === holeKey(b);
}

/**
 * Step from a hole in a direction. Main-grid up/down move one row and may cross the
 * center channel (e <-> f). Rail up/down is meaningless and returns null.
 * @param {object} hole
 * @param {'left'|'right'|'up'|'down'} dir
 * @param {number} [n=1] number of steps
 * @returns {object|null} the hole n steps away, or null if it falls off the board
 */
export function offsetHole(hole, dir, n = 1) {
    if (!isValidHole(hole) || !Number.isInteger(n)) return null;
    if (hole.kind === 'rail') {
        if (dir !== 'left' && dir !== 'right') return null;
        const index = hole.index + (dir === 'right' ? n : -n);
        const moved = { board: hole.board, kind: 'rail', rail: hole.rail, index };
        return isValidHole(moved) ? moved : null;
    }
    if (dir === 'left' || dir === 'right') {
        const col = hole.col + (dir === 'right' ? n : -n);
        const moved = { board: hole.board, kind: 'main', col, row: hole.row };
        return isValidHole(moved) ? moved : null;
    }
    if (dir === 'up' || dir === 'down') {
        const rowIndex = MAIN_ROW_INDEX[hole.row] + (dir === 'down' ? n : -n);
        if (rowIndex < 0 || rowIndex >= MAIN_ROWS.length) return null;
        return { board: hole.board, kind: 'main', col: hole.col, row: MAIN_ROWS[rowIndex] };
    }
    return null;
}

/**
 * Build a main-grid hole, or null when the column is off the board. Convenience for
 * pin-mapping code that computes columns arithmetically.
 */
export function mainHole(board, col, row) {
    const hole = { board, kind: 'main', col, row };
    return isValidHole(hole) ? hole : null;
}

/** Build a rail hole, or null when out of range. */
export function railHole(board, rail, index) {
    const hole = { board, kind: 'rail', rail, index };
    return isValidHole(hole) ? hole : null;
}

// --- Positions ---

/** X of a main-grid column, in board space. */
export function columnX(col) {
    return (MARGIN_COLS + col - 1) * PITCH;
}

/** Y of a main-grid row, in board space. */
export function rowY(row) {
    const p = ROW_Y_PITCH[row];
    return p === undefined ? null : p * PITCH;
}

/** X of a rail hole, in board space. Deliberately not aligned to columnX. */
export function railHoleX(index) {
    const group = Math.floor((index - 1) / RAIL_GROUP_SIZE);
    const within = (index - 1) % RAIL_GROUP_SIZE;
    return (RAIL_X0_PITCH + group * RAIL_GROUP_STRIDE + within) * PITCH;
}

/** Y of a rail, in board space. */
export function railY(rail) {
    const p = RAIL_Y_PITCH[rail];
    return p === undefined ? null : p * PITCH;
}

/**
 * Position of a hole in board space.
 * @returns {{x:number,y:number}|null}
 */
export function holeLocalPos(hole) {
    if (!isValidHole(hole)) return null;
    return hole.kind === 'main'
        ? { x: columnX(hole.col), y: rowY(hole.row) }
        : { x: railHoleX(hole.index), y: railY(hole.rail) };
}

/**
 * Position of a hole in world space.
 * @param {object} hole
 * @param {Map<string,{x:number,y:number}>|Record<string,{x:number,y:number}>} boards
 * @returns {{x:number,y:number}|null}
 */
export function holeWorldPos(hole, boards) {
    const local = holeLocalPos(hole);
    if (local === null) return null;
    const board = boards instanceof Map ? boards.get(hole.board) : (boards ? boards[hole.board] : null);
    if (!board) return null;
    return { x: board.x + local.x, y: board.y + local.y };
}

/** World-space bounding box of a board. */
export function boardBounds(board) {
    return {
        x: board.x,
        y: board.y,
        w: BOARD_WIDTH,
        h: BOARD_HEIGHT,
        right: board.x + BOARD_WIDTH,
        bottom: board.y + BOARD_HEIGHT
    };
}

/** True when a world-space point lies within a board's outline. */
export function pointInBoard(board, worldX, worldY) {
    return worldX >= board.x && worldX <= board.x + BOARD_WIDTH
        && worldY >= board.y && worldY <= board.y + BOARD_HEIGHT;
}

/**
 * Nearest hole on one board to a world-space point.
 * Snaps to the grid rather than scanning every hole.
 * @returns {{hole:object, dist:number}|null}
 */
export function nearestHoleOnBoard(board, worldX, worldY, maxDist = HOLE_HIT_RADIUS) {
    const lx = worldX - board.x;
    const ly = worldY - board.y;

    let best = null;
    const consider = (hole) => {
        const pos = holeLocalPos(hole);
        if (pos === null) return;
        const dx = pos.x - lx;
        const dy = pos.y - ly;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= maxDist && (best === null || dist < best.dist)) best = { hole, dist };
    };

    const col = Math.round(lx / PITCH) - MARGIN_COLS + 1;
    for (const row of MAIN_ROWS) {
        consider(mainHole(board.uid, col, row));
    }

    // Rails: invert railHoleX to get the candidate index without scanning all 50.
    const railUnit = lx / PITCH - RAIL_X0_PITCH;
    const group = Math.floor(railUnit / RAIL_GROUP_STRIDE);
    for (let g = group - 1; g <= group + 1; g++) {
        if (g < 0 || g >= RAIL_HOLES / RAIL_GROUP_SIZE) continue;
        const within = Math.round(railUnit - g * RAIL_GROUP_STRIDE);
        if (within < 0 || within >= RAIL_GROUP_SIZE) continue;
        const index = g * RAIL_GROUP_SIZE + within + 1;
        for (const rail of RAIL_NAMES) {
            consider(railHole(board.uid, rail, index));
        }
    }

    return best;
}

/**
 * Nearest hole to a world-space point across all boards.
 * @param {number} worldX
 * @param {number} worldY
 * @param {Array<{uid:string,x:number,y:number}>} boards
 * @param {number} [maxDist]
 * @returns {object|null} the hole reference, or null when nothing is close enough
 */
export function holeAtWorldPoint(worldX, worldY, boards, maxDist = HOLE_HIT_RADIUS) {
    let best = null;
    for (const board of boards) {
        const hit = nearestHoleOnBoard(board, worldX, worldY, maxDist);
        if (hit !== null && (best === null || hit.dist < best.dist)) best = hit;
    }
    return best === null ? null : best.hole;
}

/**
 * The board a world-space point falls on, or null.
 * @param {Array<{uid:string,x:number,y:number}>} boards
 */
export function boardAtWorldPoint(worldX, worldY, boards) {
    for (let i = boards.length - 1; i >= 0; i--) {
        if (pointInBoard(boards[i], worldX, worldY)) return boards[i];
    }
    return null;
}
