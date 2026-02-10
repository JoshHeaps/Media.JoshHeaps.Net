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
            `<button class="person-pill ${p.id === state.selectedPersonId ? 'active' : ''}" onclick="medDocsSelectPerson(${p.id})">${app.escapeHtml(p.name)}</button>`
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

    window.medDocsSelectPerson = (id) => app.selectPerson(id);
})(MedDocs);
