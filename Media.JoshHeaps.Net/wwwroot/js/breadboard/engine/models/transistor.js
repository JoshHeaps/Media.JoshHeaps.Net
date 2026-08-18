/**
 * Transistors: NPN and PNP bipolars, N- and P-channel MOSFETs.
 *
 * All four are the same device to this engine — a channel between pin 1 and
 * pin 3 that the control pin on pin 2 opens and closes — so they share one
 * definition factory and differ only in the polarity of the turn-on test and in
 * which mistakes are worth warning about. Pin order is the physical TO-92 one,
 * control terminal in the middle: emitter/base/collector, source/gate/drain.
 *
 * Turning on takes BOTH terminals into account, never the control pin alone. An
 * NPN conducts when its base is above its emitter, so an NPN whose emitter is
 * already sitting on the 5 V rail stays off no matter what its base does — the
 * single most common reason a beginner's high-side switch does nothing.
 *
 * The channel terminal is read EXCLUDING this device's own contribution, and
 * that is load-bearing rather than defensive. An emitter follower pulls its own
 * emitter up to what it is switching; read plainly, the device would then see
 * base and emitter at the same level, decide Vbe had collapsed, turn off, drop
 * the emitter, turn on again, and oscillate forever at the switching delay. The
 * exclusion asks the question that actually decides conduction: would current
 * flow if this device were not already conducting?
 *
 * WHAT THIS MODEL IS NOT. There is no linear region and no gain: the device is
 * saturated or cut off, nothing between. There is no Vbe and no Vce(sat), so a
 * follower's output does not sit 0.7 V below its base — the engine has no
 * voltage between 0 and 5 V to put it at (see resistor.js). And the control pin
 * is a pure high-Z input drawing no base current, which is exactly why the
 * unlimited-base warning below has to exist: the model cannot punish a missing
 * base resistor by melting, so it says so instead. A MOSFET's intrinsic body
 * diode is not modelled either, so an off device never conducts backwards.
 *
 * A conducting device passes drive strength through unchanged (conduction.js),
 * so a transistor wired collector-to-rail and emitter-to-ground still reports
 * the short circuit it would really be.
 */

import { LEVEL_HIGH, LEVEL_WEAK_HIGH, LEVEL_LOW, LEVEL_WEAK_LOW, NO_NET, STRENGTH_SUPPLY } from '../constants.js';
import { driveStrength } from '../drive.js';
import { defineModel } from './registry.js';
import { refreshBridge } from './conduction.js';

/**
 * Switching delay, ns. Slower than a contact bridging two nets because a real
 * transistor's storage and rise time genuinely dominate it, and comfortably
 * non-zero so a discrete inverter ring oscillates at a rate rather than
 * tripping the delta-cycle guard.
 */
const SWITCHING_DELAY_NS = 10;

const PIN_CHANNEL_LOW = 0; // emitter / source
const PIN_CONTROL = 1; // base / gate
const PIN_CHANNEL_HIGH = 2; // collector / drain

function isHigh(level) {
	return level === LEVEL_HIGH || level === LEVEL_WEAK_HIGH;
}

function isLow(level) {
	return level === LEVEL_LOW || level === LEVEL_WEAK_LOW;
}

/**
 * Whether the channel is open. A floating control pin reads as neither high nor
 * low and therefore leaves the device off, which is the right answer for a
 * bipolar (no base current, no conduction) and the safe one for a MOSFET, whose
 * real gate would drift somewhere unpredictable — hence the load-time warning.
 */
function isConducting(ctx, inst) {
	const control = ctx.level(inst, PIN_CONTROL);
	const channel = ctx.levelExcludingSelf(inst, PIN_CHANNEL_LOW);
	return inst.model.pChannel ? isLow(control) && isHigh(channel) : isHigh(control) && isLow(channel);
}

function refreshChannel(ctx, inst) {
	const conducting = isConducting(ctx, inst);
	refreshBridge(ctx, inst, PIN_CHANNEL_LOW, PIN_CHANNEL_HIGH, conducting, SWITCHING_DELAY_NS);
	return conducting;
}

/** A control pin nothing else touches can never switch the device. */
function warnIfControlFloating(ctx, inst) {
	const net = ctx.netOf(inst, PIN_CONTROL);
	if (net !== NO_NET && ctx.netListenerCount(net) > 1) return;
	ctx.staticWarning(
		'floatingControl',
		`${inst.type} ${inst.uid}: nothing is connected to its ${inst.model.controlName}, so it can never switch on`,
		[inst.uid],
	);
}

/**
 * Base current is what destroys a bipolar driven straight from a logic output,
 * and this engine draws none — so the mistake is reported the first time the
 * device actually conducts with an unlimited base rather than at load, where a
 * base deliberately tied to ground to hold the part off would trip it too.
 * Latched per instance: a transistor switching at 1 MHz must not re-warn.
 *
 * Evidence of a base resistor is a resistor touching the base's net, which is
 * the same dominant-resistance approximation the LED uses and inherits the same
 * blind spot — a resistor on that net need not be in series with the base. The
 * one place that approximation is not merely imprecise but WRONG is a base
 * clipped straight onto a power rail: every part on the board shares its rails,
 * so a rail nearly always carries some resistor, yet nothing is in series with
 * a base sitting on it. Supply drive strength is exactly what identifies that
 * case, so it is tested first and overrides the resistor evidence.
 *
 * The result errs one way only: it can stay quiet about a real mistake, and
 * never invents one.
 */
function warnIfBaseUnlimited(ctx, inst) {
	if (inst.state.warnedBaseDrive) return;
	const net = ctx.netOf(inst, PIN_CONTROL);
	if (net === NO_NET) return;
	const onSupplyRail = driveStrength(ctx.driveExcludingSelf(inst, PIN_CONTROL)) === STRENGTH_SUPPLY;
	if (!onSupplyRail && ctx.dominantSeriesOhms(net) > 0) return;
	inst.state.warnedBaseDrive = true;
	ctx.warn(
		'unlimitedBaseCurrent',
		[inst.uid],
		net,
		`${inst.type} ${inst.uid} is switched on through a base with no series resistor; a real one would draw destructive base current`,
	);
}

function defineTransistor(definition) {
	defineModel({
		pinCount: 3,
		delayNs: SWITCHING_DELAY_NS,
		// The two channel terminals must reach different nets for the device to
		// switch anything; the control pin may legitimately share a net with
		// either (a gate tied to its source is simply held off).
		functionalPins: [[1, 3]],

		createState() {
			return { warnedBaseDrive: false };
		},

		init(ctx, inst) {
			warnIfControlFloating(ctx, inst);
			refreshChannel(ctx, inst);
		},

		evaluate(ctx, inst) {
			// Any pin can change the answer: the control pin decides drive, the
			// channel-low pin decides whether there is a potential to drive it
			// with, and the channel-high pin changes what gets passed across.
			const conducting = refreshChannel(ctx, inst);
			if (conducting && inst.model.bipolar) warnIfBaseUnlimited(ctx, inst);
		},

		...definition,
	});
}

defineTransistor({ type: 'npn', pChannel: false, bipolar: true, controlName: 'base' });
defineTransistor({ type: 'pnp', pChannel: true, bipolar: true, controlName: 'base' });
defineTransistor({ type: 'nmos', pChannel: false, bipolar: false, controlName: 'gate' });
defineTransistor({ type: 'pmos', pChannel: true, bipolar: false, controlName: 'gate' });
