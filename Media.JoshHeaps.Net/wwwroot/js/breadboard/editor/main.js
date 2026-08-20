// Breadboard editor entry point.
//
// Boots into <div id="breadboard-editor" data-project-id data-project-name
// data-api-base>, which the Razor page renders empty - all chrome is built here.
//
// Everything user-supplied (project name, server messages, engine detail strings)
// reaches the DOM through textContent via the dom.js helpers. Nothing uses innerHTML.

import { el, createListenerBag, debounce } from './dom.js';
import { createPalette as createThemePalette } from './theme-colors.js';
import { createViewport } from './viewport.js';
import { createRenderer } from './renderer.js';
import { createEditorState } from './editor-state.js';
import { createTools } from './tools.js';
import { createToolbar } from './toolbar.js';
import { createPalette } from './palette.js';
import { createProperties } from './properties.js';
import { createStatus } from './status.js';
import { createApi, ApiError } from './api.js';
import { createSimClient } from './sim-client.js';
import { describeServerErrors } from './server-errors.js';

import {
    normalizeCircuitWithReport,
    createCircuit,
    circuitBounds
} from '../shared/circuit-schema.js';

import { boardBounds } from '../shared/board-geometry.js';

/** How long after the last edit the simulation is re-loaded. */
const SIM_RELOAD_DEBOUNCE_MS = 350;

/** How long after the last edit an autosave fires. */
const AUTOSAVE_DEBOUNCE_MS = 4000;

const VIEW_STORAGE_PREFIX = 'bb-view-';

function readView(projectId) {
    try {
        const raw = localStorage.getItem(VIEW_STORAGE_PREFIX + projectId);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;      // private mode, quota, corrupt entry - the view is optional
    }
}

function writeView(projectId, view) {
    try {
        localStorage.setItem(VIEW_STORAGE_PREFIX + projectId, JSON.stringify(view));
    } catch {
        // Losing the remembered viewport is not worth surfacing.
    }
}

export function boot(root) {
    const projectId = root.dataset.projectId;
    const apiBase = root.dataset.apiBase || '/api/breadboard';

    // Shell
    const toolbarHost = el('div', { className: 'bb-toolbar-host' });
    const canvasContainer = el('div', { className: 'bb-canvas-container' });
    const paletteHost = el('div', { className: 'bb-palette-host' });
    const propsHost = el('div', { className: 'bb-props-host' });
    const statusHost = el('div', { className: 'bb-status-host', id: 'bb-warnings' });
    const workspace = el('div', {
        className: 'bb-workspace',
        children: [paletteHost, canvasContainer, propsHost]
    });
    const shell = el('div', { className: 'bb-editor-shell', children: [toolbarHost, workspace] });
    root.appendChild(shell);

    // The status strip floats over the bottom of the canvas rather than sitting below
    // it in the column. In the column, every message that appeared or timed out resized
    // the canvas container, which reallocated all four backing stores and forced a full
    // repaint - twice per message.
    canvasContainer.appendChild(statusHost);

    const status = createStatus(statusHost);

    if (!projectId) {
        status.error('This page did not receive a project id, so there is nothing to edit.');
        return { destroy() { status.destroy(); root.removeChild(shell); } };
    }

    const bag = createListenerBag();
    const api = createApi(apiBase);
    const themePalette = createThemePalette(root);
    const viewport = createViewport();
    const renderer = createRenderer(canvasContainer, viewport, themePalette, {
        onPaintError(layer, message) {
            // A blank canvas with no explanation is the worst possible failure mode.
            status.error(`The ${layer} layer failed to draw: ${message}`);
        }
    });
    const state = createEditorState(createCircuit());

    let destroyed = false;
    let saving = false;
    /** Pending properties-panel rebuild. See scheduleProperties. */
    let propertiesFrame = null;
    let simLoadedOnce = false;
    /** Components named by a simulation warning, highlighted on the canvas. */
    const warnedUids = new Set();

    /**
     * Record the components a warning blames, so the overlay can point at them.
     *
     * Single rule for BOTH the load-time warnings array and the streaming warning
     * message: warningsSuppressed is a coalescing summary rather than a fault on any
     * component, so it must never paint a highlight. Enforcing it in one place stops
     * the two paths from disagreeing.
     */
    function addWarnedUids(warning) {
        if (!warning || warning.kind === 'warningsSuppressed') return;
        for (const uid of warning.uids || []) warnedUids.add(uid);
    }

    // --- Simulation ---

    const sim = createSimClient({
        loaded({ netCount, warnings, failed }) {
            simLoadedOnce = true;
            if (!failed) warnedUids.clear();
            for (const warning of warnings) addWarnedUids(warning);
            // A failed load still posts `loaded` so nothing waits forever. Keep the
            // error that came with it instead of clearing the list and announcing
            // success, and do not report the failure a second time.
            if (!failed) status.clearWarnings();
            for (const warning of warnings) status.addWarning(warning);
            refreshSimState();
            pushSimScene('dynamic', 'overlay');
            if (!failed && netCount > 0) {
                status.info(`Simulation ready — ${netCount} net${netCount === 1 ? '' : 's'}.`);
            }
        },
        frame() {
            pushSimScene();
            refreshSimState();
        },
        warning(warning) {
            status.addWarning(warning);
            addWarnedUids(warning);
            // Repaint here rather than waiting for an unrelated message: shortCircuit
            // and oscillation HALT the engine, so there may be no further frame at all -
            // and those are exactly the warnings whose components most need pointing at.
            pushSimScene('dynamic', 'overlay');
            // A halt is worth an explicit message; the engine refuses to run into it.
            if (warning.kind === 'shortCircuit') {
                status.error('Simulation halted: the supply rails are shorted together.');
            } else if (warning.kind === 'oscillation') {
                status.warn('Simulation halted: the circuit oscillates without settling.');
            }
            refreshSimState();
        },
        unavailable(message) {
            status.warn(`Simulation is unavailable: ${message}`);
            refreshSimState();
        }
    });

    /**
     * Hand the current simulation state to the renderer.
     *
     * Defaults to the dynamic layer alone. The overlay only shows simulation state
     * through `warnedUids`, which changes on a warning - not on every frame - so
     * callers that touch warnedUids pass 'dynamic', 'overlay' explicitly.
     */
    function pushSimScene(...layers) {
        renderer.setScene({
            netLevels: sim.state.netLevels,
            netOfStrip: sim.state.netOfStrip,
            ledBrightness: sim.state.ledBrightness,
            burned: sim.state.burned,
            warnedUids,
            simActive: sim.state.loaded
        }, ...(layers.length > 0 ? layers : ['dynamic']));
    }

    /**
     * Rebuild the properties panel at most once per frame. render() throws away and
     * rebuilds the whole panel, and a component drag fires a circuit change on every
     * pointermove, so calling it directly meant a full DOM teardown per mouse move.
     */
    function scheduleProperties() {
        if (propertiesFrame !== null) return;
        propertiesFrame = requestAnimationFrame(() => {
            propertiesFrame = null;
            if (!destroyed) properties.render(state);
        });
    }

    function refreshSimState() {
        toolbar.setSimState({
            available: sim.available,
            running: sim.state.running,
            settled: sim.state.settled,
            halted: sim.state.halted,
            loaded: simLoadedOnce
        });
    }

    const reloadSim = debounce(() => {
        if (destroyed || !sim.available) return;
        warnedUids.clear();
        sim.load(state.circuit);
    }, SIM_RELOAD_DEBOUNCE_MS);

    // --- Persistence ---

    function updateSaveState() {
        if (saving) {
            toolbar.setSaveState('saving', 'Saving…');
        } else if (state.dirty) {
            toolbar.setSaveState('dirty', 'Unsaved changes');
        } else {
            toolbar.setSaveState('clean', 'Saved');
        }
    }

    async function save() {
        if (destroyed || saving || !state.dirty) return;
        saving = true;
        updateSaveState();
        try {
            // The reporting form, so anything the document cannot carry is surfaced
            // rather than silently dropped on the way out.
            // Neutral lead-in: some problems are renames, which ARE saved, just under
            // a different id. "Not saved" would be false for those.
            const { problems } = normalizeCircuitWithReport(state.circuit);
            for (const problem of problems) status.warn(`On save: ${problem.reason}`);

            const sent = await api.saveCircuit(projectId, state.circuit);
            state.markSaved(sent);
            status.info('Saved.');
        } catch (error) {
            if (error instanceof ApiError) {
                status.errors(describeServerErrors(error.messages));
            } else {
                status.error('Saving failed unexpectedly.');
            }
        } finally {
            saving = false;
            updateSaveState();
        }
    }

    const autosave = debounce(() => {
        if (state.dirty && !saving) save();
    }, AUTOSAVE_DEBOUNCE_MS);

    // --- Chrome ---

    const toolbar = createToolbar(toolbarHost, {
        projectName: root.dataset.projectName || 'Breadboard',
        onSave: save,
        onRun: () => { sim.run(); refreshSimState(); },
        onPause: () => { sim.pause(); refreshSimState(); },
        onStep: () => sim.step(1),
        onReset: () => {
            // Clear BEFORE issuing the command: sending it can itself fail (an
            // unclonable payload throws in postMessage), and clearing afterwards would
            // wipe the very error the reset produced.
            warnedUids.clear();
            status.clearWarnings();
            sim.reset();
            status.info('Simulation reset.');
            pushSimScene('dynamic', 'overlay');
        },
        onSpeed: (eventsPerSecond) => sim.setSpeed(eventsPerSecond),
        onAddBoard: () => {
            const result = state.addBoard();
            if (!result.ok) status.warn(result.reason);
            else status.info(`Added board ${result.board.uid}.`);
        },
        onZoom: (factor) => {
            viewport.zoomAtCenter(renderer.width, renderer.height, factor);
            afterViewportChange();
        },
        onZoomFit: () => fitAll()
    });

    const palette = createPalette(paletteHost, {
        onTool: (tool) => {
            tools.setTool(tool);
            palette.setActiveTool(tool);
        },
        onWireColor: (color) => tools.setWireColor(color)
    });

    const properties = createProperties(propsHost, {
        onChangeProps: (uid, changes) => {
            const result = state.setComponentProps(uid, changes);
            if (!result.ok) status.warn(result.reason);
        },
        onToggleSwitch: (uid, switchNumber) => {
            const on = state.toggleSwitch(uid, switchNumber);
            if (on !== null) sim.setSwitch(uid, switchNumber, on);
        },
        onRotate: (uid) => {
            const result = state.rotateComponent(uid);
            if (!result.ok) status.warn(result.reason);
        },
        onDelete: (uid) => {
            state.select(uid);
            const removed = state.deleteSelected();
            if (removed > 0) status.info('Deleted.');
        },
        onDeleteSelection: () => {
            const removed = state.deleteSelected();
            if (removed > 0) status.info(`Deleted ${removed} items.`);
        },
        onFocusBoard: (uid) => {
            const board = state.circuit.boards.find(b => b.uid === uid);
            if (!board) return;
            viewport.fit(boardBounds(board), renderer.width, renderer.height);
            afterViewportChange();
        },
        onRemoveBoard: (uid) => {
            const result = state.removeBoard(uid);
            if (!result.ok) status.warn(result.reason);
            else status.info(`Removed board ${uid}${result.removed > 0 ? ` and ${result.removed} item(s) on it` : ''}.`);
        }
    });

    const tools = createTools({
        canvas: renderer.canvas,
        viewport,
        state,
        renderer,
        sim,
        status,
        initialWireColor: palette.wireColor,
        setTool: (tool) => {
            tools.setTool(tool);
            palette.setActiveTool(tool);
        },
        onSceneChange: () => {
            toolbar.setZoom(viewport.zoom);
            persistView();
        },
        onSelectionChange: () => scheduleProperties()
    });

    palette.setActiveTool({ kind: 'select', type: null });

    // --- Wiring ---

    const persistView = debounce(() => writeView(projectId, viewport.toJSON()), 400);

    function afterViewportChange() {
        renderer.viewportChanged();
        toolbar.setZoom(viewport.zoom);
        persistView();
    }

    function fitAll() {
        viewport.fit(circuitBounds(state.circuit), renderer.width, renderer.height);
        afterViewportChange();
    }

    function onContainerResize() {
        tools.invalidateRect();
        renderer.resize();
    }

    bag.on(window, 'resize', onContainerResize);
    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(onContainerResize)
        : null;
    if (resizeObserver) resizeObserver.observe(canvasContainer);

    bag.on(window, 'keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
            event.preventDefault();
            save();
        }
    });

    bag.on(window, 'beforeunload', (event) => {
        if (!state.dirty) return;
        event.preventDefault();
        event.returnValue = '';
    });

    state.subscribe((change) => {
        if (change.kind === 'circuit') {
            tools.refresh('board', 'static', 'dynamic', 'overlay');
            scheduleProperties();
            reloadSim();
            autosave();
        } else if (change.kind === 'runtime') {
            tools.refresh('dynamic', 'overlay');
        }
        updateSaveState();
    });

    // --- Load ---

    async function load() {
        try {
            const project = await api.getProject(projectId);
            if (destroyed) return;

            toolbar.setProjectName(project.name);
            if (project.name) document.title = `${project.name} — Breadboard`;

            const { circuit, problems } = normalizeCircuitWithReport(project.circuit);
            state.replace(circuit);

            // Nothing the document could not carry is allowed to vanish quietly.
            for (const problem of problems) status.warn(problem.reason);
            if (problems.length > 0) {
                status.warn(`${problems.length} item${problems.length === 1 ? '' : 's'} in the saved circuit could not be loaded exactly as stored.`);
            }

            renderer.resize();
            const savedView = readView(projectId);
            if (!viewport.restore(savedView)) fitAll();
            else afterViewportChange();

            tools.refresh('board', 'static', 'dynamic', 'overlay');
            scheduleProperties();
            updateSaveState();

            if (sim.start()) sim.load(circuit);
            sim.setSpeed(toolbar.initialSpeed);
            refreshSimState();
        } catch (error) {
            if (error instanceof ApiError) status.errors(describeServerErrors(error.messages));
            else status.error('The project could not be loaded.');
            toolbar.setSaveState('error', 'Not loaded');
        }
    }

    load();

    return {
        destroy() {
            destroyed = true;
            reloadSim.cancel();
            autosave.cancel();
            persistView.cancel();
            if (propertiesFrame !== null) cancelAnimationFrame(propertiesFrame);
            bag.removeAll();
            if (resizeObserver) resizeObserver.disconnect();
            tools.destroy();
            properties.destroy();
            palette.destroy();
            toolbar.destroy();
            renderer.destroy();
            themePalette.destroy();
            sim.destroy();
            status.destroy();
            if (shell.parentNode) shell.parentNode.removeChild(shell);
        }
    };
}

// Auto-boot. Module scripts are deferred, so the DOM is normally parsed by now, but
// guard anyway rather than assuming either way.
function start() {
    const root = document.getElementById('breadboard-editor');
    if (root && !root.dataset.booted) {
        root.dataset.booted = 'true';
        boot(root);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}
