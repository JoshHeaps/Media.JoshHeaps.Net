// Status strip: transient messages and simulation warnings.
//
// Non-intrusive by design - nothing here blocks the canvas or steals focus. Every
// string that reaches the DOM goes through textContent, because these carry server
// error text and engine detail strings.

import { el, button, setText, clear, createListenerBag } from './dom.js';

/** How long an informational message stays before fading. Warnings persist. */
const INFO_TIMEOUT_MS = 3200;

/**
 * Friendly text for the warning kinds the engine documents. Unknown kinds are rendered
 * generically rather than dropped, so a new engine warning needs no change here
 * (amendment A8).
 */
const WARNING_LABELS = Object.freeze(Object.assign(Object.create(null), {
    contention: 'Contention — two outputs are driving the same net',
    ledOvercurrent: 'LED over 20 mA',
    ledBurnout: 'LED burned out',
    shortCircuit: 'Short circuit across the supply',
    oscillation: 'Oscillation — the circuit never settles',
    floatingInput: 'Floating input',
    unpoweredChip: 'Chip has no power',
    invalidHole: 'Component is not on a valid hole',
    duplicateUid: 'Duplicate component id',
    unknownComponent: 'Unrecognised component',
    unconnectedSupply: 'Supply is not connected to anything',
    selfShorted: 'Both ends are on the same net',
    engineError: 'The simulation engine hit an internal error',
    warningsSuppressed: 'Some warnings were coalesced'
}));

const SEVERITY = Object.freeze(Object.assign(Object.create(null), {
    // A coalescing summary, not a circuit fault - it must not read as an error.
    warningsSuppressed: 'info',
    engineError: 'error',
    ledBurnout: 'error',
    shortCircuit: 'error',
    contention: 'error',
    oscillation: 'warn',
    ledOvercurrent: 'warn'
}));

function humanizeKind(kind) {
    // "someUnknownKind" -> "Some unknown kind"
    const spaced = String(kind).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function createStatus(root) {
    const bag = createListenerBag();

    const messageList = el('div', { className: 'bb-status-messages' });
    const warningList = el('div', { className: 'bb-status-warnings' });
    const warningHeader = el('div', { className: 'bb-status-warnings-header' });
    const warningTitle = el('span', { className: 'bb-status-warnings-title' });
    const clearButton = button('Clear', { className: 'bb-btn bb-btn-ghost bb-btn-small' });

    warningHeader.appendChild(warningTitle);
    warningHeader.appendChild(clearButton);

    const panel = el('div', {
        className: 'bb-status',
        attrs: { role: 'status', 'aria-live': 'polite' },
        children: [messageList, warningList]
    });
    root.appendChild(panel);

    /** kind -> { count, detail, uids, node } so repeats collapse instead of flooding. */
    const warnings = new Map();
    const timers = new Set();

    function renderWarningHeader() {
        if (warnings.size === 0) {
            if (warningHeader.parentNode) warningList.removeChild(warningHeader);
            warningList.classList.remove('is-visible');
            return;
        }
        if (!warningHeader.parentNode) warningList.insertBefore(warningHeader, warningList.firstChild);
        warningList.classList.add('is-visible');
        setText(warningTitle, `${warnings.size} issue${warnings.size === 1 ? '' : 's'}`);
    }

    function message(text, kind) {
        if (!text) return;
        const node = el('div', { className: `bb-message bb-message-${kind}`, text });
        messageList.appendChild(node);
        // Newest first, and never let the list grow without bound.
        while (messageList.childElementCount > 4) messageList.removeChild(messageList.firstChild);

        if (kind === 'info') {
            const timer = setTimeout(() => {
                timers.delete(timer);
                if (node.parentNode) node.parentNode.removeChild(node);
            }, INFO_TIMEOUT_MS);
            timers.add(timer);
        }
    }

    bag.on(clearButton, 'click', () => {
        warnings.clear();
        clear(warningList);
        renderWarningHeader();
    });

    return {
        info(text) { message(text, 'info'); },
        warn(text) { message(text, 'warn'); },
        error(text) { message(text, 'error'); },

        /** Show a list of messages, e.g. a server validation failure. */
        errors(list) {
            for (const text of list) message(text, 'error');
        },

        /**
         * Record a simulation warning. Unknown kinds render generically - never
         * dropped, never a crash.
         */
        addWarning(warning) {
            const kind = warning.kind || 'unknown';
            const existing = warnings.get(kind);
            if (existing) {
                existing.count++;
                setText(existing.countNode, `x${existing.count}`);
                if (warning.detail) setText(existing.detailNode, warning.detail);
                return;
            }

            const label = WARNING_LABELS[kind] || humanizeKind(kind);
            const severity = SEVERITY[kind] || 'warn';
            const titleNode = el('span', { className: 'bb-warning-title', text: label });
            const countNode = el('span', { className: 'bb-warning-count', text: '' });
            const detailNode = el('span', { className: 'bb-warning-detail', text: warning.detail || '' });
            const uidsText = Array.isArray(warning.uids) && warning.uids.length > 0
                ? warning.uids.join(', ') : '';
            const uidNode = el('span', { className: 'bb-warning-uids', text: uidsText });

            const node = el('div', {
                className: `bb-warning bb-warning-${severity}`,
                children: [titleNode, countNode, detailNode, uidNode]
            });
            warningList.appendChild(node);
            warnings.set(kind, { count: 1, node, countNode, detailNode });
            renderWarningHeader();
        },

        /** Drop all simulation warnings, e.g. on a fresh load. */
        clearWarnings() {
            warnings.clear();
            clear(warningList);
            renderWarningHeader();
        },

        destroy() {
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            bag.removeAll();
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        }
    };
}
