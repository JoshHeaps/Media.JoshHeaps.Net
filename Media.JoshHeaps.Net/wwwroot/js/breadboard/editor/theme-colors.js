// Canvas palette, sourced from CSS.
//
// Canvas cannot inherit CSS, so every colour the renderer draws is read out of a CSS
// custom property defined in breadboard.css. There are NO hardcoded colours in the
// renderer - change the look by editing the stylesheet, and both themes follow.
//
// site.css puts the dark palette on bare :root and overrides it under
// [data-theme="light"], so this reads whatever is currently in effect rather than
// assuming either. The site's theme customizer can also set custom properties inline
// on <html>, which is why the observer watches `style` as well as `data-theme`.

/** Every custom property the renderer needs, with a fallback if the sheet is missing. */
const TOKENS = Object.freeze({
    boardFace: ['--bb-board-face', '#e8e6df'],
    boardEdge: ['--bb-board-edge', '#c9c5b8'],
    boardBevel: ['--bb-board-bevel', '#f5f3ee'],
    channel: ['--bb-channel', '#d8d5cb'],
    channelEdge: ['--bb-channel-edge', '#bdb9ac'],
    hole: ['--bb-hole', '#3a3a3a'],
    holeRim: ['--bb-hole-rim', '#b9b5a8'],
    silk: ['--bb-silk', '#8a8578'],
    silkStrong: ['--bb-silk-strong', '#5e5a50'],
    railPlus: ['--bb-rail-plus', '#d24b4b'],
    railMinus: ['--bb-rail-minus', '#4b6fd2'],
    canvasBg: ['--bb-canvas-bg', '#1b1d21'],
    grid: ['--bb-grid', '#2a2d33'],
    hover: ['--bb-hover', '#3fb950'],
    selection: ['--bb-selection', '#58a6ff'],
    ghost: ['--bb-ghost', '#58a6ff'],
    invalid: ['--bb-invalid', '#f85149'],
    wireShadow: ['--bb-wire-shadow', 'rgba(0,0,0,0.35)'],
    chipBody: ['--bb-chip-body', '#2b2b2f'],
    chipLabel: ['--bb-chip-label', '#d8d8d8'],
    chipPin: ['--bb-chip-pin', '#c8c8cc'],
    resistorBody: ['--bb-resistor-body', '#d8c49a'],
    resistorLead: ['--bb-resistor-lead', '#b0b0b0'],
    diodeBody: ['--bb-diode-body', '#9aa7b4'],
    diodeBand: ['--bb-diode-band', '#1c1c20'],
    transistorBody: ['--bb-transistor-body', '#1f1f24'],
    buttonBody: ['--bb-button-body', '#3a3a3e'],
    buttonCap: ['--bb-button-cap', '#c9553f'],
    buttonCapDown: ['--bb-button-cap-down', '#8d3a2b'],
    dipBody: ['--bb-dip-body', '#2f4a8c'],
    dipSwitchOn: ['--bb-dip-switch-on', '#f2f2f2'],
    dipSwitchOff: ['--bb-dip-switch-off', '#8b8b90'],
    supplyBody: ['--bb-supply-body', '#26303a'],
    supplyText: ['--bb-supply-text', '#e6edf3'],
    burned: ['--bb-burned', '#4a4a4a'],
    levelLow: ['--bb-level-low', '#3b6ea5'],
    levelHigh: ['--bb-level-high', '#e0483d'],
    levelHiZ: ['--bb-level-hiz', '#7d7d85'],
    levelWeakLow: ['--bb-level-weak-low', '#4f7fa8'],
    levelWeakHigh: ['--bb-level-weak-high', '#d98a4a'],
    levelContention: ['--bb-level-contention', '#ffcc00']
});

/**
 * Net level codes from the engine's `frame` message, mapped to palette keys.
 * Index is the Uint8Array value: 0=low 1=high 2=highZ 3=weakLow 4=weakHigh 5=contention
 */
export const LEVEL_KEYS = Object.freeze([
    'levelLow', 'levelHigh', 'levelHiZ', 'levelWeakLow', 'levelWeakHigh', 'levelContention'
]);

/** Human-readable names for the same codes, for the status bar. */
export const LEVEL_NAMES = Object.freeze([
    'low', 'high', 'high-Z', 'weak low', 'weak high', 'contention'
]);

/**
 * Reads the palette from CSS and notifies subscribers when the theme changes.
 * `version` increments on every change so cached bitmaps know to re-rasterize.
 */
export function createPalette(rootElement) {
    const probe = rootElement || document.documentElement;
    let colors = read();
    let version = 0;
    const subscribers = new Set();

    function read() {
        const computed = getComputedStyle(probe);
        const next = {};
        for (const [key, [prop, fallback]] of Object.entries(TOKENS)) {
            const value = computed.getPropertyValue(prop).trim();
            next[key] = value.length > 0 ? value : fallback;
        }
        return next;
    }

    function refresh() {
        const next = read();
        const changed = Object.keys(next).some(k => next[k] !== colors[k]);
        if (!changed) return false;
        colors = next;
        version++;
        for (const fn of subscribers) fn(colors, version);
        return true;
    }

    // <html> carries both the data-theme attribute and any inline custom-property
    // overrides written by the site's theme customizer.
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'style', 'class']
    });

    return {
        /** Current colours. Treat as immutable; re-read via .colors after a change. */
        get colors() { return colors; },
        /** Bumped whenever the palette changes - use as a cache key. */
        get version() { return version; },
        /** Colour for a net level code, falling back to high-Z for unknown codes. */
        levelColor(code) {
            const key = LEVEL_KEYS[code];
            return colors[key === undefined ? 'levelHiZ' : key];
        },
        subscribe(fn) {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        },
        /** Force a re-read; returns whether anything changed. */
        refresh,
        destroy() {
            observer.disconnect();
            subscribers.clear();
        }
    };
}

/**
 * Blend a CSS colour toward transparency for glow effects. Only handles the alpha
 * channel, so it works with any colour syntax the browser accepts by delegating to
 * globalAlpha at draw time instead of parsing.
 */
export function withAlpha(ctx, alpha, draw) {
    const previous = ctx.globalAlpha;
    ctx.globalAlpha = previous * alpha;
    draw();
    ctx.globalAlpha = previous;
}
