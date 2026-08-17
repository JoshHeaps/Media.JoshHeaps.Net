// Small DOM helpers for the breadboard editor.
//
// Everything user-provided reaches the page through textContent, never innerHTML -
// project names and server error strings are both untrusted as far as this file is
// concerned.

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [options] className, id, title, type, text, attrs, dataset, children
 * @returns {HTMLElement}
 */
export function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.id) node.id = options.id;
    if (options.title) node.title = options.title;
    if (options.type) node.type = options.type;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.attrs) {
        for (const [key, value] of Object.entries(options.attrs)) {
            if (value !== null && value !== undefined) node.setAttribute(key, String(value));
        }
    }
    if (options.dataset) {
        for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = String(value);
    }
    for (const child of options.children || []) {
        if (child) node.appendChild(child);
    }
    return node;
}

/** Create a button that never submits a form. */
export function button(text, options = {}) {
    return el('button', Object.assign({ type: 'button', text }, options));
}

/** Replace an element's contents with plain text. Safe for untrusted strings. */
export function setText(node, text) {
    node.textContent = text === null || text === undefined ? '' : String(text);
}

/** Remove every child of an element. */
export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Collects event listeners so they can all be removed in one call. Every listener in
 * the editor goes through this - untracked listeners leak when the page is torn down.
 */
export function createListenerBag() {
    const entries = [];
    return {
        /** @returns {Function} a function that removes just this listener */
        on(target, type, handler, options) {
            target.addEventListener(type, handler, options);
            const entry = { target, type, handler, options };
            entries.push(entry);
            return () => {
                target.removeEventListener(type, handler, options);
                const i = entries.indexOf(entry);
                if (i !== -1) entries.splice(i, 1);
            };
        },
        removeAll() {
            for (const e of entries) e.target.removeEventListener(e.type, e.handler, e.options);
            entries.length = 0;
        }
    };
}

/**
 * Trailing-edge debounce. `cancel()` drops a pending call, `flush()` runs it now.
 */
export function debounce(fn, delay) {
    let timer = null;
    let pendingArgs = null;
    const wrapped = (...args) => {
        pendingArgs = args;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const a = pendingArgs;
            pendingArgs = null;
            fn(...a);
        }, delay);
    };
    wrapped.cancel = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pendingArgs = null;
    };
    wrapped.flush = () => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        const a = pendingArgs;
        pendingArgs = null;
        fn(...a);
    };
    return wrapped;
}

/** Format a resistance for display: 220 -> "220 Ω", 4700 -> "4.7 kΩ". */
export function formatOhms(ohms) {
    if (!Number.isFinite(ohms)) return '—';
    if (ohms >= 1000000) return `${trimZeros(ohms / 1000000)} MΩ`;
    if (ohms >= 1000) return `${trimZeros(ohms / 1000)} kΩ`;
    return `${trimZeros(ohms)} Ω`;
}

function trimZeros(value) {
    return String(Number(value.toFixed(2)));
}
