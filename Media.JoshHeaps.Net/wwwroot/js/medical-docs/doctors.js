(function (app) {
    const { state } = app;

    app.loadDoctors = async function () {
        const res = await fetch(`${app.API}/doctors`);
        if (!res.ok) return;
        state.doctors = await res.json();
        app.renderDoctors();
        app.populateDoctorDropdowns();
        app.updateSummaryCount('summaryDrCount', state.doctors.length);
    };

    state.expandedVisitPrepId = null;

    app.renderDoctors = function () {
        const container = document.getElementById('doctorsList');
        if (state.doctors.length === 0) {
            container.innerHTML = '<div class="empty-state">No doctors added yet.</div>';
            return;
        }
        container.innerHTML = state.doctors.map(doc => {
            const details = [doc.specialty, doc.phone, doc.address].filter(Boolean);
            const visitPrepBtn = state.selectedPersonId
                ? `<button onclick="medDocsToggleVisitPrep(${doc.id})">Visit Prep</button>`
                : '';
            return `<div class="doctor-card-wrapper" id="doctor-wrapper-${doc.id}">
                <div class="doctor-card" id="doctor-${doc.id}">
                    <div class="doctor-info">
                        <div class="doctor-name">${app.escapeHtml(doc.name)}</div>
                        <div class="doctor-details">${details.map(d => app.escapeHtml(d)).join(' &middot; ')}</div>
                        ${doc.notes ? `<div class="doctor-notes">${app.escapeHtml(doc.notes)}</div>` : ''}
                    </div>
                    <div class="doc-actions">
                        ${visitPrepBtn}
                        <button onclick="medDocsEditDoctor(${doc.id})">Edit</button>
                        <button class="delete-btn" onclick="medDocsDeleteDoctor(${doc.id})">Delete</button>
                    </div>
                </div>
                <div class="visit-prep-panel" id="visit-prep-${doc.id}" style="display:none"></div>
            </div>`;
        }).join('');
    };

    app.populateDoctorDropdowns = function () {
        const opts = '<option value="">Doctor (optional)</option>' +
            state.doctors.map(d => `<option value="${d.id}">${app.escapeHtml(d.name)}</option>`).join('');

        const rxSelect = document.getElementById('newRxDoctor');
        if (rxSelect) {
            const rxVal = rxSelect.value;
            rxSelect.innerHTML = opts;
            rxSelect.value = rxVal;
        }

        const billSelect = document.getElementById('newBillDoctor');
        if (billSelect) {
            const billVal = billSelect.value;
            billSelect.innerHTML = opts;
            billSelect.value = billVal;
        }
    };

    app.addDoctor = async function () {
        const name = document.getElementById('newDoctorName').value.trim();
        if (!name) return;

        const res = await fetch(`${app.API}/doctors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                specialty: document.getElementById('newDoctorSpecialty').value.trim() || null,
                phone: document.getElementById('newDoctorPhone').value.trim() || null,
                address: document.getElementById('newDoctorAddress').value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add doctor');
            return;
        }

        document.getElementById('newDoctorName').value = '';
        document.getElementById('newDoctorSpecialty').value = '';
        document.getElementById('newDoctorPhone').value = '';
        document.getElementById('newDoctorAddress').value = '';
        await app.loadDoctors();
    };

    app.deleteDoctor = async function (id) {
        if (!confirm('Delete this doctor?')) return;
        const res = await fetch(`${app.API}/doctors/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadDoctors();
    };

    app.editDoctor = function (id) {
        const doc = state.doctors.find(d => d.id === id);
        if (!doc) return;

        const card = document.getElementById(`doctor-${id}`);
        if (!card) return;

        card.innerHTML = `<div class="inline-edit-form">
            <div class="inline-form-row">
                <input type="text" id="editDoctorName-${id}" value="${app.escapeAttr(doc.name)}" class="form-input" placeholder="Name *" />
                <input type="text" id="editDoctorSpecialty-${id}" value="${app.escapeAttr(doc.specialty || '')}" class="form-input" placeholder="Specialty" />
                <input type="text" id="editDoctorPhone-${id}" value="${app.escapeAttr(doc.phone || '')}" class="form-input" placeholder="Phone" />
                <input type="text" id="editDoctorAddress-${id}" value="${app.escapeAttr(doc.address || '')}" class="form-input" placeholder="Address" />
                <button class="btn btn-primary btn-sm" onclick="medDocsSaveDoctor(${id})">Save</button>
                <button class="btn btn-secondary btn-sm" onclick="medDocsCancelEditDoctor()">Cancel</button>
            </div>
        </div>`;
    };

    app.saveDoctor = async function (id) {
        const name = document.getElementById(`editDoctorName-${id}`).value.trim();
        if (!name) return;

        const res = await fetch(`${app.API}/doctors/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                specialty: document.getElementById(`editDoctorSpecialty-${id}`).value.trim() || null,
                phone: document.getElementById(`editDoctorPhone-${id}`).value.trim() || null,
                address: document.getElementById(`editDoctorAddress-${id}`).value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to update doctor');
            return;
        }

        await app.loadDoctors();
    };

    // --- Visit Prep ---

    app.toggleVisitPrep = function (doctorId) {
        const panel = document.getElementById(`visit-prep-${doctorId}`);
        if (!panel) return;

        if (state.expandedVisitPrepId === doctorId) {
            panel.style.display = 'none';
            state.expandedVisitPrepId = null;
            return;
        }

        // Collapse previously expanded
        if (state.expandedVisitPrepId !== null) {
            const prev = document.getElementById(`visit-prep-${state.expandedVisitPrepId}`);
            if (prev) prev.style.display = 'none';
        }

        state.expandedVisitPrepId = doctorId;
        panel.style.display = '';
        panel.innerHTML = '<div style="padding:16px;color:var(--text-secondary)">Loading visit prep data...</div>';
        app.loadVisitPrep(doctorId);
    };

    app.loadVisitPrep = async function (doctorId) {
        const panel = document.getElementById(`visit-prep-${doctorId}`);
        if (!panel) return;

        try {
            const res = await fetch(`${app.API}/visit-prep?personId=${state.selectedPersonId}&doctorId=${doctorId}`);
            if (!res.ok) {
                panel.innerHTML = '<div style="padding:16px;color:var(--danger)">Failed to load visit prep data.</div>';
                return;
            }

            const data = await res.json();
            app.renderVisitPrep(doctorId, data);
        } catch {
            panel.innerHTML = '<div style="padding:16px;color:var(--danger)">Error loading visit prep.</div>';
        }
    };

    app.renderVisitPrep = function (doctorId, data) {
        const panel = document.getElementById(`visit-prep-${doctorId}`);
        if (!panel) return;

        let html = '<div class="visit-prep-content">';

        // Recent Documents
        html += '<div class="visit-prep-section"><div class="visit-prep-section-title">Recent Documents</div>';
        if (data.recentDocuments.length > 0) {
            html += data.recentDocuments.map(d => {
                const label = d.title || d.fileName || 'Untitled';
                const date = d.documentDate ? app.formatDate(d.documentDate) : '';
                const cls = d.classification ? ` <span class="doc-classification">${app.escapeHtml(app.formatClassification(d.classification))}</span>` : '';
                return `<div class="visit-prep-item">${app.escapeHtml(label)}${cls}${date ? ' <span class="visit-prep-date">' + date + '</span>' : ''}</div>`;
            }).join('');
        } else {
            html += '<div class="visit-prep-item" style="color:var(--text-secondary)">No documents for this doctor</div>';
        }
        html += '</div>';

        // Active Conditions
        html += '<div class="visit-prep-section"><div class="visit-prep-section-title">Active Conditions</div>';
        if (data.activeConditions.length > 0) {
            html += '<div class="visit-prep-badges">' + data.activeConditions.map(c =>
                `<span class="badge-active">${app.escapeHtml(c.name)}</span>`
            ).join(' ') + '</div>';
        } else {
            html += '<div class="visit-prep-item" style="color:var(--text-secondary)">No active conditions</div>';
        }
        html += '</div>';

        // Current Medications
        html += '<div class="visit-prep-section"><div class="visit-prep-section-title">Current Medications</div>';
        if (data.activePrescriptions.length > 0) {
            html += data.activePrescriptions.map(rx => {
                const details = [rx.dosage, rx.frequency].filter(Boolean).join(', ');
                return `<div class="visit-prep-item">${app.escapeHtml(rx.medicationName)}${details ? ' <span class="visit-prep-date">' + app.escapeHtml(details) + '</span>' : ''}</div>`;
            }).join('');
        } else {
            html += '<div class="visit-prep-item" style="color:var(--text-secondary)">No active prescriptions</div>';
        }
        html += '</div>';

        // Recent Bills
        html += '<div class="visit-prep-section"><div class="visit-prep-section-title">Recent Bills (6 months)</div>';
        if (data.recentBills.length > 0) {
            html += data.recentBills.map(b => {
                const date = b.billDate ? app.formatDate(b.billDate) : '';
                return `<div class="visit-prep-item">${app.formatCurrency(b.totalAmount)}${b.summary ? ' - ' + app.escapeHtml(b.summary) : ''}${date ? ' <span class="visit-prep-date">' + date + '</span>' : ''}</div>`;
            }).join('');
        } else {
            html += '<div class="visit-prep-item" style="color:var(--text-secondary)">No recent bills</div>';
        }
        html += '</div>';

        // AI Summary
        html += '<div class="visit-prep-section">';
        html += `<button class="btn btn-primary btn-sm" id="aiSummaryBtn-${doctorId}" onclick="medDocsGenerateVisitSummary(${doctorId})">Generate AI Summary</button>`;
        html += `<div class="ai-summary-card" id="aiSummary-${doctorId}" style="display:none"></div>`;
        html += '</div>';

        html += '</div>';
        panel.innerHTML = html;
    };

    app.generateVisitSummary = async function (doctorId) {
        const btn = document.getElementById(`aiSummaryBtn-${doctorId}`);
        const card = document.getElementById(`aiSummary-${doctorId}`);
        if (!btn || !card) return;

        btn.disabled = true;
        btn.textContent = 'Generating...';
        card.style.display = '';
        card.innerHTML = '<div class="ai-summary-loading">Generating AI summary...</div>';

        try {
            const res = await fetch(`${app.API}/visit-prep/summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personId: state.selectedPersonId, doctorId })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                card.innerHTML = '<div style="color:var(--danger)">' + app.escapeHtml(err.error || 'Failed to generate summary') + '</div>';
                btn.disabled = false;
                btn.textContent = 'Generate AI Summary';
                return;
            }

            const data = await res.json();
            card.innerHTML = '<div class="ai-summary-text">' + app.escapeHtml(data.summary || 'No summary generated.').replace(/\n/g, '<br>') + '</div>';
            btn.textContent = 'Regenerate Summary';
            btn.disabled = false;
        } catch {
            card.innerHTML = '<div style="color:var(--danger)">Error generating summary.</div>';
            btn.disabled = false;
            btn.textContent = 'Generate AI Summary';
        }
    };

    window.medDocsAddDoctor = () => app.addDoctor();
    window.medDocsDeleteDoctor = (id) => app.deleteDoctor(id);
    window.medDocsEditDoctor = (id) => app.editDoctor(id);
    window.medDocsSaveDoctor = (id) => app.saveDoctor(id);
    window.medDocsCancelEditDoctor = () => app.renderDoctors();
    window.medDocsToggleVisitPrep = (id) => app.toggleVisitPrep(id);
    window.medDocsGenerateVisitSummary = (id) => app.generateVisitSummary(id);
})(MedDocs);
