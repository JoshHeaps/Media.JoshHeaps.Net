(function (app) {
    const { state } = app;

    app.loadConditions = async function () {
        const personParam = state.selectedPersonId ? `?personId=${state.selectedPersonId}` : '';
        const res = await fetch(`${app.API}/conditions${personParam}`);
        if (!res.ok) return;
        const conditions = await res.json();
        app.renderConditions(conditions);
        app.updateSummaryCount('summaryCondCount', conditions.length);
    };

    app.renderConditions = function (conditions) {
        const container = document.getElementById('conditionsList');
        if (conditions.length === 0) {
            container.innerHTML = '<div class="empty-state">No conditions tracked yet.</div>';
            return;
        }
        container.innerHTML = conditions.map(c => {
            const meta = [];
            if (c.diagnosedDate) meta.push('Diagnosed: ' + app.formatDate(c.diagnosedDate));
            const statusBadge = c.isActive
                ? '<span class="badge-active">Active</span>'
                : '<span class="badge-inactive">Inactive</span>';
            return `<div class="condition-item" id="condition-${c.id}">
                <div class="condition-info">
                    <div class="condition-name">${app.personBadge(c.personId)}${app.escapeHtml(c.name)} ${statusBadge}</div>
                    ${meta.length ? `<div class="condition-meta">${meta.join(' &middot; ')}</div>` : ''}
                    ${c.notes ? `<div class="condition-meta">${app.escapeHtml(c.notes)}</div>` : ''}
                </div>
                <div class="doc-actions">
                    <button onclick="medDocsToggleCondition(${c.id}, ${!c.isActive})">${c.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button class="delete-btn" onclick="medDocsDeleteCondition(${c.id})">Delete</button>
                </div>
            </div>`;
        }).join('');
    };

    app.addCondition = async function () {
        const name = document.getElementById('newConditionName').value.trim();
        if (!name) return;

        const res = await fetch(`${app.API}/conditions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: state.selectedPersonId,
                name,
                diagnosedDate: document.getElementById('newConditionDate').value || null,
                notes: document.getElementById('newConditionNotes').value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add condition');
            return;
        }

        document.getElementById('newConditionName').value = '';
        document.getElementById('newConditionDate').value = '';
        document.getElementById('newConditionNotes').value = '';
        await app.loadConditions();
    };

    app.toggleConditionActive = async function (id, isActive) {
        const toggleParam = state.selectedPersonId ? `?personId=${state.selectedPersonId}` : '';
        const res = await fetch(`${app.API}/conditions${toggleParam}`);
        if (!res.ok) return;
        const conditions = await res.json();
        const condition = conditions.find(c => c.id === id);
        if (!condition) return;

        const updateRes = await fetch(`${app.API}/conditions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: condition.name,
                diagnosedDate: condition.diagnosedDate,
                notes: condition.notes,
                isActive
            })
        });

        if (!updateRes.ok) {
            const err = await updateRes.json().catch(() => ({}));
            alert(err.error || 'Failed to update condition');
            return;
        }

        await app.loadConditions();
    };

    app.deleteCondition = async function (id) {
        if (!confirm('Delete this condition?')) return;
        const res = await fetch(`${app.API}/conditions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadConditions();
    };

    window.medDocsAddCondition = () => app.addCondition();
    window.medDocsDeleteCondition = (id) => app.deleteCondition(id);
    window.medDocsToggleCondition = (id, isActive) => app.toggleConditionActive(id, isActive);
})(MedDocs);
