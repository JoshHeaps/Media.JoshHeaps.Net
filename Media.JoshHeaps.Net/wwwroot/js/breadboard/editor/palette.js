// Component palette and tool selection.
//
// Driven entirely by the shared component registry, so a new component type appears
// here without touching this file.

import { el, button, createListenerBag } from './dom.js';
import { COMPONENT_TYPES, getComponentDef } from '../shared/component-registry.js';
import { WIRE_COLORS, DEFAULT_WIRE_COLOR } from '../shared/circuit-schema.js';

const CATEGORY_ORDER = Object.freeze(['passive', 'output', 'input', 'power', 'chip']);
const CATEGORY_LABELS = Object.freeze(Object.assign(Object.create(null), {
    passive: 'Passive',
    output: 'Output',
    input: 'Input',
    power: 'Power',
    chip: 'Logic'
}));

export function createPalette(root, handlers) {
    const bag = createListenerBag();
    const toolButtons = new Map();

    function toolButton(key, label, title) {
        const node = button(label, { className: 'bb-tool', title });
        node.dataset.tool = key;
        toolButtons.set(key, node);
        return node;
    }

    const selectButton = toolButton('select', 'Select', 'Select, move and rotate parts (Esc)');
    const wireButton = toolButton('wire', 'Wire', 'Drag from hole to hole to run a wire');

    const colorSwatches = el('div', { className: 'bb-swatches' });
    let activeColor = DEFAULT_WIRE_COLOR;
    const swatchNodes = new Map();
    for (const color of WIRE_COLORS) {
        const swatch = button('', {
            className: 'bb-swatch',
            title: `Wire colour ${color}`,
            attrs: { 'aria-label': `Wire colour ${color}` }
        });
        swatch.style.background = color;
        swatchNodes.set(color, swatch);
        bag.on(swatch, 'click', () => {
            setColor(color);
            handlers.onWireColor(color);
        });
        colorSwatches.appendChild(swatch);
    }

    function setColor(color) {
        activeColor = color;
        for (const [value, node] of swatchNodes) node.classList.toggle('is-active', value === color);
    }
    setColor(DEFAULT_WIRE_COLOR);

    const sections = [
        el('div', {
            className: 'bb-palette-section',
            children: [
                el('h2', { className: 'bb-palette-heading', text: 'Tools' }),
                el('div', { className: 'bb-palette-grid', children: [selectButton, wireButton] }),
                colorSwatches
            ]
        })
    ];

    // Component buttons, grouped by registry category.
    const byCategory = new Map();
    for (const type of COMPONENT_TYPES) {
        const def = getComponentDef(type);
        if (!byCategory.has(def.category)) byCategory.set(def.category, []);
        byCategory.get(def.category).push(def);
    }

    for (const category of CATEGORY_ORDER) {
        const defs = byCategory.get(category);
        if (!defs || defs.length === 0) continue;
        const grid = el('div', { className: 'bb-palette-grid' });
        for (const def of defs) {
            const node = toolButton(`place:${def.type}`, def.label, def.description || def.label);
            node.classList.add('bb-tool-component');
            grid.appendChild(node);
        }
        sections.push(el('div', {
            className: 'bb-palette-section',
            children: [
                el('h2', { className: 'bb-palette-heading', text: CATEGORY_LABELS[category] || category }),
                grid
            ]
        }));
    }

    const hint = el('p', {
        className: 'bb-palette-hint',
        text: 'Space or middle-drag pans. Scroll to zoom. R rotates, Delete removes.'
    });
    sections.push(hint);

    const panel = el('aside', { className: 'bb-palette', children: sections });
    root.appendChild(panel);

    for (const [key, node] of toolButtons) {
        bag.on(node, 'click', () => {
            if (key === 'select') handlers.onTool({ kind: 'select', type: null });
            else if (key === 'wire') handlers.onTool({ kind: 'wire', type: null });
            else handlers.onTool({ kind: 'place', type: key.slice('place:'.length) });
        });
    }

    return {
        get wireColor() { return activeColor; },

        setActiveTool(tool) {
            const key = tool.kind === 'place' ? `place:${tool.type}` : tool.kind;
            for (const [name, node] of toolButtons) node.classList.toggle('is-active', name === key);
        },

        setWireColor: setColor,

        destroy() {
            bag.removeAll();
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        }
    };
}
