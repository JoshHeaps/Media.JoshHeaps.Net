// Client for the simulation worker.
//
// Speaks the engine protocol exactly. This module owns ALL knowledge of the worker
// message shapes; the rest of the editor sees plain callbacks and a small state
// object, so a protocol change lands in one file.
//
// Behaviours of the engine that the UI must not misread, per the engine pair:
//   - The worker AUTO-PAUSES when the circuit settles. Frame silence is normal for a
//     combinational circuit, not a hang. `settled` says so explicitly.
//   - `input` works while paused; the worker settles the consequences and posts a
//     frame immediately, so a button press updates the view without pressing run.
//   - `run` can REFUSE: on a rail-to-rail short it posts a frame with halted:true and
//     does not start. The UI must reflect that the run did not take.
//   - A burned LED reports 0 mA, which is also what an off LED reports. Burnout is
//     known ONLY from the one-shot `ledBurnout` warning, so it is latched here and
//     cleared on load/reset.

const WORKER_URL = '/js/breadboard/engine/worker.js';

/** Current at which an LED is drawn at full brightness (also the overcurrent point). */
const FULL_BRIGHTNESS_MA = 20;

export function createSimClient(handlers = {}) {
    let worker = null;
    let available = false;
    let loadError = null;

    const state = {
        running: false,
        settled: false,
        halted: false,
        loaded: false,
        netCount: 0,
        simTimeNs: 0,
        netOfStrip: new Map(),
        pinNets: new Map(),        // uid -> [netId per pin], -1 when unconnected
        ledOrder: [],
        netLevels: null,
        ledCurrentMa: new Map(),   // uid -> mA
        ledBrightness: new Map(),  // uid -> 0..1
        burned: new Set(),
        // Set by a worker `error`, cleared only when WE send a new load/reset. A failed
        // load posts BOTH `error` and `loaded`, so this survives the `loaded` that
        // follows and stops the failure being reported twice or wiped from the list.
        engineError: null
    };

    function emit(name, ...args) {
        const handler = handlers[name];
        if (typeof handler === 'function') handler(...args);
    }

    function resetDerived() {
        state.netOfStrip = new Map();
        state.pinNets = new Map();
        state.ledOrder = [];
        state.netLevels = null;
        state.ledCurrentMa = new Map();
        state.ledBrightness = new Map();
        state.burned = new Set();
        state.running = false;
        state.settled = false;
        state.halted = false;
        state.simTimeNs = 0;
    }

    function handleLoaded(message) {
        const carriedError = state.engineError;
        resetDerived();
        state.engineError = carriedError;
        state.loaded = true;

        // The engine reports a failed load two ways: a preceding `error` message, and a
        // `loadFailed` entry in these warnings with nets:0. Either means this is not a
        // valid empty circuit, so check both rather than trusting nets===0.
        const warnings = Array.isArray(message.warnings) ? message.warnings : [];
        const loadFailed = warnings.some(w => w && w.kind === 'loadFailed');
        state.netCount = typeof message.nets === 'number' ? message.nets : 0;

        const index = message.netIndex || {};
        if (index.strips && typeof index.strips === 'object') {
            state.netOfStrip = new Map(Object.entries(index.strips));
        }
        if (index.components && typeof index.components === 'object') {
            for (const [uid, nets] of Object.entries(index.components)) {
                if (Array.isArray(nets)) state.pinNets.set(uid, nets);
            }
        }
        state.ledOrder = Array.isArray(index.ledOrder) ? index.ledOrder.slice() : [];

        if (loadFailed) state.halted = true;

        emit('loaded', {
            netCount: state.netCount,
            warnings,
            // The engine posts `loaded` even when the load failed, so that anything
            // awaiting it is released. Tell the UI not to treat this as a clean start.
            failed: carriedError !== null || loadFailed
        });
    }

    function handleFrame(message) {
        state.netLevels = message.netLevels instanceof Uint8Array ? message.netLevels : null;
        state.simTimeNs = typeof message.simTimeNs === 'number' ? message.simTimeNs : state.simTimeNs;
        // Additive fields beyond the spec; absent on an older engine, so default safely.
        if (typeof message.running === 'boolean') state.running = message.running;
        if (typeof message.settled === 'boolean') state.settled = message.settled;
        if (typeof message.halted === 'boolean') state.halted = message.halted;
        if (state.halted) state.running = false;

        const currents = message.ledStates;
        if (currents && currents.length >= 0) {
            for (let i = 0; i < state.ledOrder.length && i < currents.length; i++) {
                const uid = state.ledOrder[i];
                const ma = currents[i];
                state.ledCurrentMa.set(uid, ma);
                // A burned LED also reports 0 mA, so the latched flag - not the
                // current - decides whether it is drawn as dead.
                state.ledBrightness.set(uid, state.burned.has(uid)
                    ? 0
                    : Math.max(0, Math.min(1, ma / FULL_BRIGHTNESS_MA)));
            }
        }
        emit('frame', state);
    }

    function handleWarning(message) {
        if (message.kind === 'ledBurnout' && Array.isArray(message.uids)) {
            for (const uid of message.uids) {
                state.burned.add(uid);
                state.ledBrightness.set(uid, 0);
            }
        }
        // Unknown kinds are passed through untouched - the status surface renders them
        // generically so a new engine warning needs no change here.
        emit('warning', {
            kind: typeof message.kind === 'string' ? message.kind : 'unknown',
            uids: Array.isArray(message.uids) ? message.uids : [],
            netId: message.netId,
            detail: typeof message.detail === 'string' ? message.detail : ''
        });
    }

    /**
     * The engine threw internally (amendment A13). The worker is still alive but its
     * state is not to be trusted, so stop the transport and tell the user - never
     * leave the UI waiting on frames that will not come.
     */
    function handleError(message) {
        state.running = false;
        state.halted = true;
        const context = typeof message.context === 'string' && message.context.length > 0
            ? message.context : 'simulation';
        const detail = typeof message.message === 'string' ? message.message : '';
        state.engineError = { context, detail };
        emit('warning', {
            kind: 'engineError',
            uids: Array.isArray(message.uids) ? message.uids : [],
            netId: message.netId,
            detail: detail ? `${context}: ${detail}` : context
        });
        emit('frame', state);
    }

    /**
     * The Worker failed to start or threw at the top level. Separate from the engine's
     * own `error` message, which is a structured report from a worker that is running.
     */
    function onWorkerError(event) {
        loadError = event.message || 'The simulation engine failed to start.';
        available = false;
        state.running = false;
        emit('unavailable', loadError);
    }

    function onMessage(event) {
        const message = event.data;
        if (!message || typeof message.type !== 'string') return;
        switch (message.type) {
            case 'loaded': handleLoaded(message); break;
            case 'frame': handleFrame(message); break;
            case 'warning': handleWarning(message); break;
            case 'error': handleError(message); break;
            default:
                // Forward-compatible, but NEVER silent about a failure: an unrecognised
                // message that carries error-shaped fields is surfaced rather than
                // dropped, because a swallowed error looks exactly like a hung worker.
                if (/error|fail/i.test(message.type)
                    || typeof message.message === 'string'
                    || typeof message.context === 'string') {
                    handleError(message);
                }
                break;
        }
    }

    function post(message) {
        if (worker === null) return;
        try {
            worker.postMessage(message);
        } catch (error) {
            // Structured clone failed, so the message NEVER REACHED the worker: no
            // loaded, no frame, and no engine-side `error` either, because the engine
            // was never told. Without this the careful error plumbing is bypassed and
            // the UI waits forever. Route it into the same failure path.
            handleError({
                context: message && message.type ? message.type : 'postMessage',
                message: error && error.message ? error.message : String(error)
            });
        }
    }

    return {
        state,
        get available() { return available; },
        get loadError() { return loadError; },

        /**
         * Start the worker. Failure is reported rather than thrown, so the editor
         * still works without simulation.
         * @returns {boolean} whether the worker started
         */
        start() {
            if (worker !== null) return true;
            try {
                worker = new Worker(WORKER_URL, { type: 'module' });
            } catch (error) {
                loadError = error && error.message ? error.message : String(error);
                available = false;
                emit('unavailable', loadError);
                return false;
            }
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onWorkerError);
            available = true;
            return true;
        },

        /** Send a circuit for net extraction. Clears burnout and run state. */
        load(circuit) {
            resetDerived();
            state.engineError = null;
            state.loaded = false;
            post({ type: 'load', circuit });
        },

        run() {
            state.running = true;          // optimistic; a halted frame corrects it
            post({ type: 'run' });
        },

        pause() {
            state.running = false;
            post({ type: 'pause' });
        },

        step(count = 1) {
            post({ type: 'step', count });
        },

        setSpeed(eventsPerSecond) {
            post({ type: 'setSpeed', eventsPerSecond });
        },

        /** Button press/release. */
        setButton(uid, pressed) {
            post({ type: 'input', uid, value: pressed === true });
        },

        /** DIP toggle. `pin` is the SWITCH number 1..8, not the package pin. */
        setSwitch(uid, pin, on) {
            post({ type: 'input', uid, value: { pin, on: on === true } });
        },

        /** Re-load the last circuit, clearing LED burnout. */
        reset() {
            state.burned.clear();
            state.ledBrightness.clear();
            state.engineError = null;
            state.halted = false;
            post({ type: 'reset' });
        },

        /** Net level code for a strip key, or -1 when unknown. */
        levelForStrip(stripKey) {
            if (!state.netLevels) return -1;
            const netId = state.netOfStrip.get(stripKey);
            if (netId === undefined || netId < 0 || netId >= state.netLevels.length) return -1;
            return state.netLevels[netId];
        },

        destroy() {
            if (worker !== null) {
                // Removed by name rather than relying on terminate() to take the
                // listeners with it, so teardown does not depend on that detail.
                worker.removeEventListener('message', onMessage);
                worker.removeEventListener('error', onWorkerError);
                worker.terminate();
                worker = null;
            }
            available = false;
            resetDerived();
        }
    };
}

export { FULL_BRIGHTNESS_MA };
