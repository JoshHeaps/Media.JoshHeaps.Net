(function (app) {
    const { state } = app;

    app.switchMainTab = function (tabName) {
        if (!state.selectedPersonId && tabName !== 'doctors') return;

        state.activeTab = tabName;

        document.querySelectorAll('.main-tab').forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        document.querySelectorAll('.tab-panel').forEach(panel => {
            if (panel.id === 'panel-' + tabName) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        document.querySelectorAll('.summary-card').forEach(card => {
            if (card.dataset.tab === tabName) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    };

    app.updateTabStates = function () {
        var personTabs = ['documents', 'conditions', 'prescriptions', 'bills', 'timeline'];
        personTabs.forEach(function (tab) {
            var btn = document.querySelector('.main-tab[data-tab="' + tab + '"]');
            if (btn) {
                if (state.selectedPersonId) {
                    btn.classList.remove('disabled');
                } else {
                    btn.classList.add('disabled');
                }
            }
        });
    };

    app.switchUploadTab = function (tab) {
        document.querySelectorAll('.upload-sub-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.add-form-collapsible .tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector(`.upload-sub-tabs .tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`tab-${tab}`).classList.add('active');
    };

    app.toggleAddForm = function (panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const collapsible = panel.querySelector('.add-form-collapsible');
        if (collapsible) {
            collapsible.classList.toggle('open');
        }
    };

    window.medDocsSwitchTab = (tabName) => app.switchMainTab(tabName);
    window.medDocsToggleAddForm = (panelId) => app.toggleAddForm(panelId);
})(MedDocs);
