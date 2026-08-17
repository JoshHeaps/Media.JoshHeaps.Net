// Properties side panel: edits the selected component, and manages boards.
//
// Controls are generated from the registry's propSpecs, so a new scalar property on a
// component type gets an editor here for free.

import { el, button, setText, clear, createListenerBag, formatOhms } from './dom.js';
import { getComponentDef, LED_COLORS } from '../shared/component-registry.js';
import { componentSelfShorts, componentPinsWithNames } from '../shared/component-pins.js';

function field(labelText, control) {
    return el('label', {
        className: 'bb-field',
        children: [el('span', { className: 'bb-field-label', text: labelText }), control]
    });
}

export function createProperties(root, handlers) {
    // Panel-lifetime listeners.
    const bag = createListenerBag();
    // Listeners for the controls rebuilt on every render. Cleared each time, otherwise
    // the bag would keep every detached button and its closure alive for the session.
    const renderBag = createListenerBag();
    const body = el('div', { className: 'bb-props-body' });
    const boardsBody = el('div', { className: 'bb-boards-body' });

    const panel = el('aside', {
        className: 'bb-props',
        children: [
            el('h2', { className: 'bb-props-heading', text: 'Properties' }),
            body,
            el('h2', { className: 'bb-props-heading', text: 'Boards' }),
            boardsBody
        ]
    });
    root.appendChild(panel);

    function buildEnumControl(component, key, spec) {
        const select = el('select', { className: 'bb-input' });
        // LED colours get their swatch shown alongside the name.
        const options = key === 'color'
            ? LED_COLORS.map(c => ({ value: c.value, label: c.label }))
            : spec.values.map(v => ({ value: v, label: v }));
        for (const option of options) {
            const node = el('option', { text: option.label, attrs: { value: option.value } });
            if (component.props[key] === option.value) node.selected = true;
            select.appendChild(node);
        }
        renderBag.on(select, 'change', () => handlers.onChangeProps(component.uid, { [key]: select.value }));
        return select;
    }

    function buildNumberControl(component, key, spec) {
        const input = el('input', {
            className: 'bb-input',
            attrs: {
                type: 'number', min: String(spec.min), max: String(spec.max),
                step: '1', value: String(component.props[key])
            }
        });
        const commit = () => {
            const value = Number(input.value);
            if (!Number.isFinite(value)) {
                input.value = String(component.props[key]);
                return;
            }
            const clamped = Math.min(spec.max, Math.max(spec.min, value));
            input.value = String(clamped);
            handlers.onChangeProps(component.uid, { [key]: clamped });
        };
        renderBag.on(input, 'change', commit);
        renderBag.on(input, 'keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
        });

        const wrapper = el('div', { className: 'bb-field-stack', children: [input] });

        if (Array.isArray(spec.presets)) {
            const presets = el('div', { className: 'bb-presets' });
            for (const preset of spec.presets) {
                const node = button(formatOhms(preset), { className: 'bb-chip-btn' });
                renderBag.on(node, 'click', () => {
                    input.value = String(preset);
                    handlers.onChangeProps(component.uid, { [key]: preset });
                });
                presets.appendChild(node);
            }
            wrapper.appendChild(presets);
        }
        return wrapper;
    }

    function buildBoolArrayControl(component, key, spec) {
        const row = el('div', { className: 'bb-switch-row' });
        const values = Array.isArray(component.props[key]) ? component.props[key] : [];
        for (let i = 0; i < spec.length; i++) {
            const node = button(String(i + 1), {
                className: `bb-switch-toggle${values[i] ? ' is-on' : ''}`,
                title: `Switch ${i + 1}: ${values[i] ? 'on' : 'off'}`
            });
            renderBag.on(node, 'click', () => handlers.onToggleSwitch(component.uid, i + 1));
            row.appendChild(node);
        }
        return row;
    }

    function renderComponent(component) {
        const def = getComponentDef(component.type);
        if (def === null) return;

        body.appendChild(el('div', {
            className: 'bb-props-title',
            children: [
                el('strong', { text: def.label }),
                el('span', { className: 'bb-props-uid', text: component.uid })
            ]
        }));

        if (def.description) {
            body.appendChild(el('p', { className: 'bb-props-description', text: def.description }));
        }

        for (const [key, spec] of Object.entries(def.propSpecs)) {
            let control = null;
            if (spec.kind === 'enum') control = buildEnumControl(component, key, spec);
            else if (spec.kind === 'number') control = buildNumberControl(component, key, spec);
            else if (spec.kind === 'boolArray') control = buildBoolArrayControl(component, key, spec);
            if (control !== null) {
                body.appendChild(field(spec.unit ? `${spec.label} (${spec.unit})` : spec.label, control));
            }
        }

        // Placement summary - where the part actually sits.
        const pins = componentPinsWithNames(component);
        const placed = pins.filter(p => p.hole !== null);
        if (placed.length > 0) {
            const first = placed[0].hole;
            const where = first.kind === 'main'
                ? `board ${first.board}, column ${first.col} row ${first.row}`
                : `board ${first.board}, ${first.rail} rail`;
            body.appendChild(el('p', { className: 'bb-props-meta', text: `${pins.length} pins at ${where}` }));
        }

        const shorts = componentSelfShorts(component);
        if (shorts.length > 0) {
            body.appendChild(el('p', {
                className: 'bb-props-warning',
                text: 'Both ends of this part sit in the same connected strip, so it will have no effect.'
            }));
        }

        const actions = el('div', { className: 'bb-props-actions' });
        if (def.orientable) {
            const rotate = button('Rotate (R)', { className: 'bb-btn' });
            renderBag.on(rotate, 'click', () => handlers.onRotate(component.uid));
            actions.appendChild(rotate);
        }
        const remove = button('Delete', { className: 'bb-btn bb-btn-danger' });
        renderBag.on(remove, 'click', () => handlers.onDelete(component.uid));
        actions.appendChild(remove);
        body.appendChild(actions);
    }

    function renderWire(wire) {
        body.appendChild(el('div', {
            className: 'bb-props-title',
            children: [el('strong', { text: 'Wire' }), el('span', { className: 'bb-props-uid', text: wire.uid })]
        }));
        const describe = (hole) => hole.kind === 'main'
            ? `${hole.board} · ${hole.col}${hole.row}`
            : `${hole.board} · ${hole.rail} ${hole.index}`;
        body.appendChild(el('p', {
            className: 'bb-props-meta',
            text: `${describe(wire.from)} → ${describe(wire.to)}`
        }));

        const actions = el('div', { className: 'bb-props-actions' });
        const remove = button('Delete', { className: 'bb-btn bb-btn-danger' });
        renderBag.on(remove, 'click', () => handlers.onDelete(wire.uid));
        actions.appendChild(remove);
        body.appendChild(actions);
    }

    return {
        /** Re-render for the current selection. */
        render(state) {
            renderBag.removeAll();
            clear(body);
            const selection = [...state.selection];

            if (selection.length === 0) {
                body.appendChild(el('p', {
                    className: 'bb-props-empty',
                    text: 'Select a part or wire to edit it.'
                }));
            } else if (selection.length > 1) {
                body.appendChild(el('p', {
                    className: 'bb-props-empty',
                    text: `${selection.length} items selected.`
                }));
                const actions = el('div', { className: 'bb-props-actions' });
                const remove = button(`Delete ${selection.length} items`, { className: 'bb-btn bb-btn-danger' });
                renderBag.on(remove, 'click', () => handlers.onDeleteSelection());
                actions.appendChild(remove);
                body.appendChild(actions);
            } else {
                const uid = selection[0];
                const component = state.circuit.components.find(c => c.uid === uid);
                if (component) renderComponent(component);
                else {
                    const wire = state.circuit.wires.find(w => w.uid === uid);
                    if (wire) renderWire(wire);
                }
            }

            this.renderBoards(state);
        },

        /** Rebuilds the board list. Its listeners belong to renderBag - render() clears
         *  it first, so calling this directly is only valid from render(). */
        renderBoards(state) {
            clear(boardsBody);
            for (const board of state.circuit.boards) {
                const onBoard = state.circuit.components.filter(c =>
                    (c.anchor && c.anchor.board === board.uid) || (c.props && c.props.board === board.uid)).length;
                const row = el('div', { className: 'bb-board-row' });
                row.appendChild(el('span', { className: 'bb-board-name', text: board.uid }));
                row.appendChild(el('span', { className: 'bb-board-count', text: `${onBoard} part${onBoard === 1 ? '' : 's'}` }));

                const focus = button('Show', { className: 'bb-btn bb-btn-small' });
                renderBag.on(focus, 'click', () => handlers.onFocusBoard(board.uid));
                row.appendChild(focus);

                if (state.circuit.boards.length > 1) {
                    const remove = button('Remove', { className: 'bb-btn bb-btn-small bb-btn-danger' });
                    renderBag.on(remove, 'click', () => handlers.onRemoveBoard(board.uid));
                    row.appendChild(remove);
                }
                boardsBody.appendChild(row);
            }
        },

        destroy() {
            renderBag.removeAll();
            bag.removeAll();
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        }
    };
}
