/**
 * Shared constants for the breadboard simulation engine.
 *
 * IMMUTABILITY BOUNDARY (read this before editing anything in engine/):
 *   - constants.js, drive.js, union-find.js, net-builder.js and every model's
 *     pin/description table are PURE: no mutation, no I/O, safe to call from
 *     anywhere and freely testable.
 *   - net-state.js, event-queue.js and simulation.js own the HOT PATH. They use
 *     typed arrays and controlled in-place mutation on purpose. Nothing outside
 *     those three files may mutate their buffers; they expose accessor methods.
 */

/** Wire-format net level codes. These exact numbers go to the UI in `frame.netLevels`. */
export const LEVEL_LOW = 0;
export const LEVEL_HIGH = 1;
export const LEVEL_HIGHZ = 2;
export const LEVEL_WEAK_LOW = 3;
export const LEVEL_WEAK_HIGH = 4;
export const LEVEL_CONTENTION = 5;

/** Drive strengths, ordered. A higher strength always wins over a lower one. */
export const STRENGTH_HIGHZ = 0;
export const STRENGTH_WEAK = 1;
export const STRENGTH_STRONG = 2;
export const STRENGTH_SUPPLY = 3;

export const VALUE_LOW = 0;
export const VALUE_HIGH = 1;

/**
 * What a chip input samples when its net is neither a clean low nor a clean
 * high. A floating 74HC input is physically indeterminate, so the engine
 * refuses to guess: it propagates UNKNOWN through three-valued logic and a
 * gate whose output cannot be determined releases its driver to high-Z.
 */
export const INPUT_LOW = 0;
export const INPUT_HIGH = 1;
export const INPUT_UNKNOWN = 2;

/** Maps a net level code to what a chip input pin reads off it. */
export const LEVEL_TO_INPUT = new Uint8Array([
	INPUT_LOW, // LEVEL_LOW
	INPUT_HIGH, // LEVEL_HIGH
	INPUT_UNKNOWN, // LEVEL_HIGHZ  -- floating, indeterminate
	INPUT_LOW, // LEVEL_WEAK_LOW   -- a pull-down still reads as a low
	INPUT_HIGH, // LEVEL_WEAK_HIGH -- a pull-up still reads as a high
	INPUT_UNKNOWN, // LEVEL_CONTENTION
]);

export const SUPPLY_VOLTAGE = 5.0;

/** Nominal voltage a net sits at, by level code. NaN means "indeterminate". */
export const LEVEL_VOLTAGE = new Float64Array([
	0.0, // LEVEL_LOW
	SUPPLY_VOLTAGE, // LEVEL_HIGH
	NaN, // LEVEL_HIGHZ
	0.0, // LEVEL_WEAK_LOW
	SUPPLY_VOLTAGE, // LEVEL_WEAK_HIGH
	NaN, // LEVEL_CONTENTION
]);

/** Sentinel for "this pin is not connected to any net". */
export const NO_NET = -1;

/** Default gate propagation delay, ns. Per-type values live in each model. */
export const DEFAULT_DELAY_NS = 10;

/**
 * Guards against zero-delay feedback loops (e.g. an inverter wired to itself
 * through a component with no delay). Exceeding this at a single sim instant
 * raises a warning and pauses instead of hanging the worker.
 */
export const MAX_EVENTS_PER_INSTANT = 100000;

/** LED current thresholds, amps. */
export const LED_WARN_CURRENT = 0.020;
export const LED_BURNOUT_CURRENT = 0.050;

/**
 * Resistance an LED presents when nothing limits it. Real LEDs have a few ohms
 * of bulk resistance; the point of the small number is that a resistor-less LED
 * across 5 V computes a burnout-level current, which is what really happens.
 */
export const LED_INTRINSIC_OHMS = 10;

/** Forward voltage by LED colour. */
export const LED_FORWARD_VOLTAGE = Object.freeze({
	red: 1.8,
	yellow: 2.1,
	orange: 2.0,
	green: 2.1,
	blue: 3.0,
	white: 3.2,
});

export const DEFAULT_LED_FORWARD_VOLTAGE = 2.0;
