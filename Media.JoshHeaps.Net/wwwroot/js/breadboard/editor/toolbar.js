// Top toolbar: project identity, save state, simulation transport, zoom.

import { el, button, setText, createListenerBag } from './dom.js';

/** Simulation speed presets, in engine events per second. */
const SPEED_STEPS = Object.freeze([1, 10, 100, 1000, 10000, 100000, 1000000, 10000000]);
const DEFAULT_SPEED_INDEX = 5;

function formatSpeed(eventsPerSecond) {
    if (eventsPerSecond >= 1000000) return `${eventsPerSecond / 1000000} M events/s`;
    if (eventsPerSecond >= 1000) return `${eventsPerSecond / 1000} k events/s`;
    return `${eventsPerSecond} events/s`;
}

export function createToolbar(root, handlers) {
    const bag = createListenerBag();

    const title = el('h1', { className: 'bb-title', text: handlers.projectName || 'Breadboard' });
    const saveState = el('span', { className: 'bb-save-state', text: 'Loading…' });
    const saveButton = button('Save', { className: 'bb-btn bb-btn-primary', attrs: { 'aria-keyshortcuts': 'Control+S' } });

    const runButton = button('Run', { className: 'bb-btn bb-btn-run', title: 'Start the simulation' });
    const pauseButton = button('Pause', { className: 'bb-btn', title: 'Pause the simulation' });
    const stepButton = button('Step', { className: 'bb-btn', title: 'Advance one event' });
    const resetButton = button('Reset', { className: 'bb-btn', title: 'Reload the circuit and clear burned-out parts' });
    const simState = el('span', { className: 'bb-sim-state', text: 'idle' });

    const speedInput = el('input', {
        className: 'bb-speed',
        attrs: {
            type: 'range', min: '0', max: String(SPEED_STEPS.length - 1),
            step: '1', value: String(DEFAULT_SPEED_INDEX),
            'aria-label': 'Simulation speed'
        }
    });
    const speedLabel = el('span', { className: 'bb-speed-label', text: formatSpeed(SPEED_STEPS[DEFAULT_SPEED_INDEX]) });

    const zoomOut = button('−', { className: 'bb-btn bb-btn-icon', title: 'Zoom out' });
    const zoomIn = button('+', { className: 'bb-btn bb-btn-icon', title: 'Zoom in' });
    const zoomFit = button('Fit', { className: 'bb-btn', title: 'Fit all boards in view' });
    const zoomLabel = el('span', { className: 'bb-zoom-label', text: '100%' });

    const addBoardButton = button('Add board', { className: 'bb-btn' });

    const group = (className, children) => el('div', { className: `bb-toolbar-group ${className}`, children });

    const bar = el('div', {
        className: 'bb-toolbar',
        children: [
            group('bb-group-project', [title, saveState, saveButton]),
            group('bb-group-sim', [runButton, pauseButton, stepButton, resetButton, simState]),
            group('bb-group-speed', [speedLabel, speedInput]),
            group('bb-group-view', [addBoardButton, zoomOut, zoomLabel, zoomIn, zoomFit])
        ]
    });
    root.appendChild(bar);

    bag.on(saveButton, 'click', () => handlers.onSave());
    bag.on(runButton, 'click', () => handlers.onRun());
    bag.on(pauseButton, 'click', () => handlers.onPause());
    bag.on(stepButton, 'click', () => handlers.onStep());
    bag.on(resetButton, 'click', () => handlers.onReset());
    bag.on(addBoardButton, 'click', () => handlers.onAddBoard());
    bag.on(zoomIn, 'click', () => handlers.onZoom(1.25));
    bag.on(zoomOut, 'click', () => handlers.onZoom(1 / 1.25));
    bag.on(zoomFit, 'click', () => handlers.onZoomFit());
    bag.on(speedInput, 'input', () => {
        const speed = SPEED_STEPS[Number(speedInput.value)] || SPEED_STEPS[DEFAULT_SPEED_INDEX];
        setText(speedLabel, formatSpeed(speed));
        handlers.onSpeed(speed);
    });

    return {
        get initialSpeed() { return SPEED_STEPS[DEFAULT_SPEED_INDEX]; },

        setProjectName(name) {
            setText(title, name || 'Breadboard');
        },

        /**
         * Reflect save state.
         * @param {'clean'|'dirty'|'saving'|'error'} kind
         */
        setSaveState(kind, text) {
            saveState.className = `bb-save-state bb-save-${kind}`;
            setText(saveState, text);
            saveButton.disabled = kind === 'saving' || kind === 'clean';
        },

        /**
         * Reflect simulation state. `halted` means the engine refused to run - a
         * rail-to-rail short - so the run button must visibly not take.
         */
        setSimState({ available, running, settled, halted, loaded }) {
            runButton.disabled = !available || running || halted;
            pauseButton.disabled = !available || !running;
            stepButton.disabled = !available || running;
            resetButton.disabled = !available;
            speedInput.disabled = !available;

            let label = 'idle';
            if (!available) label = 'engine unavailable';
            else if (halted) label = 'halted — fix the fault, then reset';
            else if (running) label = 'running';
            else if (settled) label = 'settled';
            else if (loaded) label = 'paused';
            simState.className = `bb-sim-state${halted ? ' bb-sim-halted' : ''}${running ? ' bb-sim-running' : ''}`;
            setText(simState, label);
        },

        setZoom(zoom) {
            setText(zoomLabel, `${Math.round(zoom * 100)}%`);
        },

        destroy() {
            bag.removeAll();
            if (bar.parentNode) bar.parentNode.removeChild(bar);
        }
    };
}

export { SPEED_STEPS };
