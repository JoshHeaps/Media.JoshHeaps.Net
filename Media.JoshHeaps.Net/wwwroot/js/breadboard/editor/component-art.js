// Drawing routines for each component type.
//
// Everything here draws in WORLD space - the caller has already applied the
// device-pixel-ratio base transform and the pan/zoom world transform. One world unit
// is one board-space pixel, so PITCH is the hole spacing in the units used here.
//
// Colours come from the palette (CSS custom properties), never from literals, except
// LED lens colours which are a physical property of the part.

import {
    PITCH,
    holeWorldPos,
    railY,
    railHoleX,
    RAIL_HOLES
} from '../shared/board-geometry.js';

import { getComponentDef, isChipType, ledColorHex } from '../shared/component-registry.js';
import { componentPinHoles } from '../shared/component-pins.js';
import { formatOhms } from './dom.js';

/**
 * World positions of a component's pins.
 * @returns {Array<{x:number,y:number}|null>} index-aligned with the pin list
 */
export function pinPositions(component, boards) {
    return componentPinHoles(component).map(p => (p.hole === null ? null : holeWorldPos(p.hole, boards)));
}

/** Centre of a component's placed pins, or null when nothing is placed. */
export function componentCenter(component, boards) {
    const points = pinPositions(component, boards).filter(p => p !== null);
    if (points.length === 0) return null;
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Axis-aligned world bounds of a component, padded to its drawn body.
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function componentBounds(component, boards) {
    const points = pinPositions(component, boards).filter(p => p !== null);
    if (points.length === 0) return null;
    const pad = PITCH * 0.5;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function drawLead(ctx, from, to, colors) {
    ctx.strokeStyle = colors.resistorLead;
    ctx.lineWidth = PITCH * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
}

// --- Per-type painters. Each receives already-resolved pin positions. ---

function drawLed(ctx, component, pins, colors, state) {
    const [anode, cathode] = pins;
    if (!anode || !cathode) return;

    const lens = ledColorHex(component.props && component.props.color);
    const mid = { x: (anode.x + cathode.x) / 2, y: (anode.y + cathode.y) / 2 };
    const radius = PITCH * 0.36;
    const burned = state.burned === true;
    const brightness = burned ? 0 : Math.max(0, Math.min(1, state.brightness || 0));

    drawLead(ctx, anode, cathode, colors);

    // Emission halo, drawn under the lens so the lens stays readable.
    if (brightness > 0.01) {
        const glowRadius = radius * (2.2 + brightness * 2.4);
        const glow = ctx.createRadialGradient(mid.x, mid.y, radius * 0.4, mid.x, mid.y, glowRadius);
        glow.addColorStop(0, lens);
        glow.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.15 + brightness * 0.55;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    ctx.fillStyle = burned ? colors.burned : lens;
    ctx.globalAlpha = burned ? 1 : 0.55 + brightness * 0.45;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Flat on the cathode side, as on a real LED.
    const angle = Math.atan2(cathode.y - anode.y, cathode.x - anode.x);
    ctx.strokeStyle = burned ? colors.burned : colors.silkStrong;
    ctx.lineWidth = PITCH * 0.07;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, radius, angle - Math.PI / 3, angle + Math.PI / 3);
    ctx.stroke();

    if (burned) {
        ctx.strokeStyle = colors.invalid;
        ctx.lineWidth = PITCH * 0.1;
        ctx.beginPath();
        ctx.moveTo(mid.x - radius * 0.7, mid.y - radius * 0.7);
        ctx.lineTo(mid.x + radius * 0.7, mid.y + radius * 0.7);
        ctx.moveTo(mid.x + radius * 0.7, mid.y - radius * 0.7);
        ctx.lineTo(mid.x - radius * 0.7, mid.y + radius * 0.7);
        ctx.stroke();
    }
}

function drawResistor(ctx, component, pins, colors, state, zoom) {
    const [a, b] = pins;
    if (!a || !b) return;

    drawLead(ctx, a, b, colors);

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const bodyLength = Math.max(PITCH * 0.8, Math.min(length * 0.62, PITCH * 2.4));
    const bodyHeight = PITCH * 0.44;

    ctx.save();
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(angle);

    ctx.fillStyle = colors.resistorBody;
    roundRect(ctx, -bodyLength / 2, -bodyHeight / 2, bodyLength, bodyHeight, bodyHeight * 0.45);
    ctx.fill();

    // Value bands. Decorative rather than an encoded E12 colour code, but they read
    // instantly as a resistor at any zoom.
    ctx.fillStyle = colors.silkStrong;
    const bandWidth = bodyLength * 0.075;
    for (let i = 0; i < 3; i++) {
        const x = -bodyLength * 0.3 + i * bodyLength * 0.2;
        ctx.fillRect(x, -bodyHeight / 2, bandWidth, bodyHeight);
    }

    // The value itself, only when there are enough device pixels to read it.
    if (zoom > 1.1) {
        ctx.fillStyle = colors.silkStrong;
        ctx.font = `${PITCH * 0.36}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const upsideDown = Math.abs(angle) > Math.PI / 2;
        ctx.rotate(upsideDown ? Math.PI : 0);
        ctx.fillText(formatOhms(component.props && component.props.ohms), 0, -bodyHeight * 0.75);
    }
    ctx.restore();
}

function drawDiode(ctx, component, pins, colors) {
    const [anode, cathode] = pins;
    if (!anode || !cathode) return;

    drawLead(ctx, anode, cathode, colors);

    const angle = Math.atan2(cathode.y - anode.y, cathode.x - anode.x);
    const length = Math.hypot(cathode.x - anode.x, cathode.y - anode.y);
    const bodyLength = Math.max(PITCH * 0.5, Math.min(length * 0.6, PITCH * 1.8));
    const bodyHeight = PITCH * 0.34;

    ctx.save();
    ctx.translate((anode.x + cathode.x) / 2, (anode.y + cathode.y) / 2);
    ctx.rotate(angle);

    ctx.fillStyle = colors.diodeBody;
    roundRect(ctx, -bodyLength / 2, -bodyHeight / 2, bodyLength, bodyHeight, bodyHeight * 0.3);
    ctx.fill();

    // The band marks the cathode, which after the rotation is always the +x end.
    ctx.fillStyle = colors.diodeBand;
    ctx.fillRect(bodyLength * 0.24, -bodyHeight / 2, bodyLength * 0.16, bodyHeight);

    ctx.restore();
}

/**
 * TO-92 package seen from above: a flat face with a domed back, sitting over its own
 * three holes. Everything is drawn within half a pitch of the pin row so the body stays
 * inside componentBounds, which is what hit-testing and dirty-rect culling use.
 */
function drawTransistor(ctx, component, pins, colors, zoom) {
    const placed = pins.filter(p => p !== null);
    if (placed.length < 3) return;

    const xs = placed.map(p => p.x);
    const ys = placed.map(p => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const cy = y + (Math.max(...ys) - y) / 2;
    const pad = PITCH * 0.34;
    const left = x - pad;
    const right = x + w + pad;
    const flatY = cy + PITCH * 0.42;
    const backY = cy - PITCH * 0.52;

    ctx.strokeStyle = colors.chipPin;
    ctx.lineWidth = PITCH * 0.12;
    ctx.lineCap = 'butt';
    for (const pin of placed) {
        ctx.beginPath();
        ctx.moveTo(pin.x, flatY - PITCH * 0.1);
        ctx.lineTo(pin.x, flatY + PITCH * 0.16);
        ctx.stroke();
    }

    ctx.fillStyle = colors.transistorBody;
    ctx.beginPath();
    ctx.moveTo(left, flatY);
    ctx.lineTo(right, flatY);
    ctx.lineTo(right, backY + PITCH * 0.22);
    ctx.quadraticCurveTo((left + right) / 2, backY - PITCH * 0.28, left, backY + PITCH * 0.22);
    ctx.closePath();
    ctx.fill();

    const def = getComponentDef(component.type);
    ctx.fillStyle = colors.chipLabel;
    ctx.textAlign = 'center';

    if (zoom > 1.4) {
        // Leg letters, taken from the registry's pin names so they can never disagree
        // with the netlist. They follow the pins, so a rotated part reads correctly.
        ctx.font = `${PITCH * 0.26}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < 3; i++) {
            if (pins[i]) ctx.fillText(def.pins[i].name[0].toUpperCase(), pins[i].x, flatY - PITCH * 0.08);
        }
        ctx.globalAlpha = 1;
    }

    if (zoom > 0.9) {
        ctx.font = `${PITCH * 0.3}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(def.label, (left + right) / 2, backY + PITCH * 0.3);
    }
}

function drawPushButton(ctx, component, pins, colors, state) {
    const placed = pins.filter(p => p !== null);
    if (placed.length < 4) return;

    const xs = placed.map(p => p.x);
    const ys = placed.map(p => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    const pad = PITCH * 0.34;

    for (const pin of placed) {
        drawLead(ctx, pin, { x: x + w / 2, y: pin.y }, colors);
    }

    ctx.fillStyle = colors.buttonBody;
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, PITCH * 0.18);
    ctx.fill();

    const pressed = state.pressed === true;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const capRadius = Math.min(w, h) * 0.42 + PITCH * 0.1;

    ctx.fillStyle = pressed ? colors.buttonCapDown : colors.buttonCap;
    ctx.beginPath();
    ctx.arc(cx, cy, pressed ? capRadius * 0.88 : capRadius, 0, Math.PI * 2);
    ctx.fill();

    if (!pressed) {
        ctx.strokeStyle = colors.buttonCapDown;
        ctx.lineWidth = PITCH * 0.06;
        ctx.beginPath();
        ctx.arc(cx, cy, capRadius, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawDipSwitch(ctx, component, pins, colors, state, zoom) {
    const placed = pins.filter(p => p !== null);
    if (placed.length < 16) return;

    const xs = placed.map(p => p.x);
    const ys = placed.map(p => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    const pad = PITCH * 0.3;

    ctx.fillStyle = colors.dipBody;
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, PITCH * 0.12);
    ctx.fill();

    const on = (component.props && Array.isArray(component.props.on)) ? component.props.on : [];
    const slotWidth = w / 7;                 // 8 switches across 7 column gaps
    const slotHeight = h * 0.52;

    for (let k = 0; k < 8; k++) {
        // Switch k lives in the column of pins k+1 and 16-k.
        const pin = pins[k];
        if (!pin) continue;
        const cx = pin.x;
        const cy = y + h / 2;
        const sw = slotWidth * 0.44;

        ctx.fillStyle = colors.dipSwitchOff;
        ctx.globalAlpha = 0.35;
        roundRect(ctx, cx - sw / 2, cy - slotHeight / 2, sw, slotHeight, PITCH * 0.05);
        ctx.fill();
        ctx.globalAlpha = 1;

        const isOn = on[k] === true;
        ctx.fillStyle = isOn ? colors.dipSwitchOn : colors.dipSwitchOff;
        const leverHeight = slotHeight * 0.42;
        const leverY = isOn ? cy - slotHeight / 2 : cy + slotHeight / 2 - leverHeight;
        roundRect(ctx, cx - sw / 2, leverY, sw, leverHeight, PITCH * 0.04);
        ctx.fill();
    }

    if (zoom > 1.3) {
        ctx.fillStyle = colors.dipSwitchOn;
        ctx.globalAlpha = 0.75;
        ctx.font = `${PITCH * 0.26}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let k = 0; k < 8; k++) {
            if (pins[k]) ctx.fillText(String(k + 1), pins[k].x, y - pad + PITCH * 0.04);
        }
        ctx.globalAlpha = 1;
    }
}

function drawChip(ctx, component, pins, colors, state, zoom) {
    const placed = pins.filter(p => p !== null);
    if (placed.length < 14) return;

    const xs = placed.map(p => p.x);
    const ys = placed.map(p => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    const padX = PITCH * 0.32;
    const padY = PITCH * 0.55;

    // Legs
    ctx.strokeStyle = colors.chipPin;
    ctx.lineWidth = PITCH * 0.13;
    ctx.lineCap = 'butt';
    for (const pin of placed) {
        const towardBody = pin.y < y + h / 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(pin.x, pin.y);
        ctx.lineTo(pin.x, pin.y + towardBody * padY * 0.8);
        ctx.stroke();
    }

    ctx.fillStyle = colors.chipBody;
    roundRect(ctx, x - padX, y - padY * 0.15, w + padX * 2, h + padY * 0.3, PITCH * 0.1);
    ctx.fill();

    // Pin-1 notch, at the end where pin 1 actually is.
    const pin1 = pins[0];
    const notchAtLeft = pin1 && pin1.x <= x + w / 2;
    const notchX = notchAtLeft ? x - padX : x + w + padX;
    ctx.fillStyle = colors.chipLabel;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(notchX, y + h / 2, PITCH * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Pin-1 dot
    if (pin1) {
        ctx.fillStyle = colors.chipLabel;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(pin1.x, y + h / 2 - (pin1.y < y + h / 2 ? -1 : 1) * h * 0.28, PITCH * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    if (zoom > 0.75) {
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        // Row-'f' anchored chips are the package rotated 180 degrees; keep the text
        // upright regardless so the part number stays readable.
        ctx.fillStyle = colors.chipLabel;
        ctx.font = `${PITCH * 0.42}px "SF Mono", ui-monospace, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(component.type, 0, 0);
        ctx.restore();
    }
}

function drawPowerSupply(ctx, component, pins, colors, state, zoom, boards) {
    const props = component.props || {};
    const board = boards instanceof Map ? boards.get(props.board) : null;
    if (!board) return;

    const side = props.side === 'bottom' ? 'bottom' : 'top';
    const plusY = railY(side === 'top' ? 'topPlus' : 'bottomPlus');
    const minusY = railY(side === 'top' ? 'topMinus' : 'bottomMinus');
    const midY = board.y + (plusY + minusY) / 2;

    // Clipped to the right-hand end of the rails so it never covers holes.
    const x = board.x + railHoleX(RAIL_HOLES) + PITCH * 1.4;
    const w = PITCH * 2.6;
    const h = PITCH * 1.7;

    ctx.fillStyle = colors.supplyBody;
    roundRect(ctx, x, midY - h / 2, w, h, PITCH * 0.2);
    ctx.fill();
    ctx.strokeStyle = colors.railPlus;
    ctx.lineWidth = PITCH * 0.07;
    ctx.stroke();

    // Leads back to each rail
    for (const [y, color] of [[board.y + plusY, colors.railPlus], [board.y + minusY, colors.railMinus]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = PITCH * 0.11;
        ctx.beginPath();
        ctx.moveTo(x, midY);
        ctx.lineTo(board.x + railHoleX(RAIL_HOLES), y);
        ctx.stroke();
    }

    if (zoom > 0.6) {
        ctx.fillStyle = colors.supplyText;
        ctx.font = `${PITCH * 0.5}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('5V', x + w / 2, midY);
    }
}

/**
 * Draw one component.
 * @param {CanvasRenderingContext2D} ctx world-transformed context
 * @param {object} component
 * @param {Map<string,object>} boards
 * @param {object} colors palette
 * @param {object} state runtime state: { brightness, burned, pressed }
 * @param {number} zoom current zoom, used to drop text detail when it would be unreadable
 */
export function drawComponent(ctx, component, boards, colors, state, zoom) {
    const def = getComponentDef(component.type);
    if (def === null) return;
    const pins = pinPositions(component, boards);

    if (isChipType(component.type)) {
        drawChip(ctx, component, pins, colors, state, zoom);
        return;
    }
    switch (component.type) {
        case 'led': drawLed(ctx, component, pins, colors, state); break;
        case 'resistor': drawResistor(ctx, component, pins, colors, state, zoom); break;
        case 'diode': drawDiode(ctx, component, pins, colors); break;
        case 'npn': case 'pnp': case 'nmos': case 'pmos':
            drawTransistor(ctx, component, pins, colors, zoom);
            break;
        case 'pushButton': drawPushButton(ctx, component, pins, colors, state); break;
        case 'dipSwitch8': drawDipSwitch(ctx, component, pins, colors, state, zoom); break;
        case 'powerSupply5V': drawPowerSupply(ctx, component, pins, colors, state, zoom, boards); break;
        default: break;
    }
}

/**
 * Draw a wire as a shallow arc, so overlapping wires stay distinguishable.
 * @param {object} [options] levelColor paints a halo showing the net's logic level
 */
export function drawWire(ctx, from, to, color, options = {}) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    // Perpendicular sag proportional to length, capped so long wires do not balloon.
    const sag = Math.min(length * 0.14, PITCH * 2.2);
    const mid = { x: (from.x + to.x) / 2 - (dy / (length || 1)) * sag, y: (from.y + to.y) / 2 + (dx / (length || 1)) * sag };

    const stroke = () => {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(mid.x, mid.y, to.x, to.y);
        ctx.stroke();
    };

    ctx.lineCap = 'round';
    if (options.levelColor) {
        ctx.strokeStyle = options.levelColor;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = PITCH * 0.42;
        stroke();
        ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = options.shadow || 'rgba(0,0,0,0.25)';
    ctx.lineWidth = PITCH * 0.24;
    ctx.save();
    ctx.translate(0, PITCH * 0.06);
    stroke();
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = PITCH * 0.2;
    stroke();

    // End collars, so a wire visibly plugs into its hole.
    ctx.fillStyle = color;
    for (const point of [from, to]) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, PITCH * 0.15, 0, Math.PI * 2);
        ctx.fill();
    }
}
