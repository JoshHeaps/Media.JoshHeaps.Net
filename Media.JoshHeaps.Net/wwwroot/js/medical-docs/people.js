(function (app) {
    const { state } = app;

    app.loadPeople = async function () {
        const res = await fetch(`${app.API}/people`);
        if (!res.ok) return;
        state.people = await res.json();
        app.renderPeople();
    };

    app.renderPeople = function () {
        const container = document.getElementById('peopleList');
        container.innerHTML = state.people.map(p =>
            `<div class="person-pill-row">
                <button class="person-pill ${p.id === state.selectedPersonId ? 'active' : ''}" onclick="medDocsSelectPerson(${p.id})">${app.escapeHtml(p.name)}</button>
                <button class="person-share-btn" onclick="medDocsOpenShareModal(${p.id}, event)" title="Share access">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
                </button>
            </div>`
        ).join('');
    };

    app.addPerson = async function () {
        const input = document.getElementById('newPersonName');
        const name = input.value.trim();
        if (!name) return;

        const res = await fetch(`${app.API}/people`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to add person');
            return;
        }

        input.value = '';
        const person = await res.json();
        await app.loadPeople();
        app.selectPerson(person.id);
    };

    app.selectPerson = function (personId) {
        state.selectedPersonId = personId;
        app.renderPeople();

        document.getElementById('summaryCards').style.display = '';
        document.getElementById('filterBar').style.display = '';
        app.updateTabStates();

        app.clearFilters(false);

        app.loadFilterTags();
        app.loadFilterConditions();
        app.populateFilterDoctorDropdown();

        app.loadDocuments();
        app.loadConditions();
        app.loadPrescriptions();
        app.loadBills();
        app.loadTimeline();

        app.switchMainTab('documents');
    };

    // --- Share Access ---

    app.openShareModal = async function (personId, event) {
        event.stopPropagation();
        state.sharePersonId = personId;
        document.getElementById('shareAccessOverlay').style.display = '';
        document.getElementById('shareUsername').value = '';
        await app.loadShareAccess(personId);
    };

    app.closeShareModal = function (event) {
        if (event && event.target !== event.currentTarget) return;
        document.getElementById('shareAccessOverlay').style.display = 'none';
        state.sharePersonId = null;
    };

    app.loadShareAccess = async function (personId) {
        const container = document.getElementById('shareAccessList');
        container.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';

        const res = await fetch(`${app.API}/people/${personId}/access`);
        if (!res.ok) {
            container.innerHTML = '<div style="color:var(--text-muted);">Failed to load access list</div>';
            return;
        }

        const users = await res.json();
        state.shareAccessUsers = users;

        if (users.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);">No users have access</div>';
            return;
        }

        container.innerHTML = users.map(u =>
            `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-primary);">
                <span>${app.escapeHtml(u.username)}</span>
                <button class="btn btn-danger btn-sm" onclick="medDocsRevokeAccess(${personId}, ${u.id})" ${users.length <= 1 ? 'disabled title="Cannot remove the last user"' : ''} style="padding:0.15rem 0.5rem;font-size:0.75rem;">&times;</button>
            </div>`
        ).join('');
    };

    app.grantAccess = async function () {
        const input = document.getElementById('shareUsername');
        const username = input.value.trim();
        if (!username || !state.sharePersonId) return;

        const res = await fetch(`${app.API}/people/${state.sharePersonId}/access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to grant access');
            return;
        }

        input.value = '';
        await app.loadShareAccess(state.sharePersonId);
    };

    app.revokeAccess = async function (personId, targetUserId) {
        const res = await fetch(`${app.API}/people/${personId}/access/${targetUserId}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to revoke access');
            return;
        }

        await app.loadShareAccess(personId);
    };

    window.medDocsSelectPerson = (id) => app.selectPerson(id);
    window.medDocsOpenShareModal = (id, event) => app.openShareModal(id, event);
    window.medDocsCloseShareModal = (event) => app.closeShareModal(event);
    window.medDocsGrantAccess = () => app.grantAccess();
    window.medDocsRevokeAccess = (personId, userId) => app.revokeAccess(personId, userId);
})(MedDocs);
