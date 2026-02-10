(function (app) {
    const { state } = app;

    app.loadPrescriptions = async function () {
        if (!state.selectedPersonId) return;
        const res = await fetch(`${app.API}/prescriptions?personId=${state.selectedPersonId}`);
        if (!res.ok) return;
        const prescriptions = await res.json();
        state.currentPrescriptions = prescriptions;
        app.renderPrescriptions(prescriptions);
        app.updateSummaryCount('summaryRxCount', prescriptions.length);
    };

    app.renderPrescriptions = function (prescriptions) {
        const container = document.getElementById('prescriptionsList');
        if (prescriptions.length === 0) {
            container.innerHTML = '<div class="empty-state">No prescriptions tracked yet.</div>';
            return;
        }
        container.innerHTML = prescriptions.map(rx => {
            const meta = [];
            if (rx.rxNumber) meta.push('RX# ' + rx.rxNumber);
            if (rx.dosage) meta.push(rx.dosage);
            if (rx.frequency) meta.push(rx.frequency);
            if (rx.doctorName) meta.push('Dr. ' + rx.doctorName);
            if (rx.startDate) meta.push('Started: ' + app.formatDate(rx.startDate));
            const lastPickup = rx.lastPickupDate ? app.formatDate(rx.lastPickupDate) : 'None';
            const statusBadge = rx.isActive
                ? '<span class="badge-active">Active</span>'
                : '<span class="badge-inactive">Inactive</span>';
            return `<div class="prescription-item" id="rx-${rx.id}">
                <div class="prescription-header" onclick="medDocsTogglePickups(${rx.id})">
                    <div class="prescription-info">
                        <div class="prescription-name">
                            <span class="expand-btn" id="expand-${rx.id}">&#9654;</span>
                            ${app.escapeHtml(rx.medicationName)} ${statusBadge}
                        </div>
                        <div class="prescription-meta">${meta.map(m => app.escapeHtml(m)).join(' &middot; ')}</div>
                        <div class="prescription-meta">Last pickup: ${app.escapeHtml(lastPickup)}</div>
                    </div>
                    <div class="doc-actions" onclick="event.stopPropagation()">
                        <button onclick="medDocsEditPrescription(${rx.id})">Edit</button>
                        <button class="delete-btn" onclick="medDocsDeletePrescription(${rx.id})">Delete</button>
                    </div>
                </div>
                <div class="pickup-section" id="pickups-${rx.id}" style="display: none;">
                    <div class="pickup-form">
                        <div class="inline-form-row">
                            <input type="date" id="pickupDate-${rx.id}" class="form-input" title="Pickup date" />
                            <input type="text" id="pickupQty-${rx.id}" placeholder="Quantity" class="form-input" />
                            <input type="text" id="pickupPharmacy-${rx.id}" placeholder="Pharmacy" class="form-input" />
                            <input type="number" id="pickupCost-${rx.id}" placeholder="Cost" class="form-input" step="0.01" />
                            <button class="btn btn-primary btn-sm" onclick="medDocsAddPickup(${rx.id})">Log Pickup</button>
                        </div>
                    </div>
                    <div class="pickup-list" id="pickupList-${rx.id}"></div>
                </div>
            </div>`;
        }).join('');
    };

    app.addPrescription = async function () {
        const medication = document.getElementById('newRxMedication').value.trim();
        if (!medication) return;

        const doctorId = document.getElementById('newRxDoctor').value;

        const res = await fetch(`${app.API}/prescriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: state.selectedPersonId,
                medicationName: medication,
                dosage: document.getElementById('newRxDosage').value.trim() || null,
                frequency: document.getElementById('newRxFrequency').value.trim() || null,
                doctorId: doctorId ? parseInt(doctorId) : null,
                startDate: document.getElementById('newRxStartDate').value || null,
                rxNumber: document.getElementById('newRxNumber').value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add prescription');
            return;
        }

        document.getElementById('newRxMedication').value = '';
        document.getElementById('newRxNumber').value = '';
        document.getElementById('newRxDosage').value = '';
        document.getElementById('newRxFrequency').value = '';
        document.getElementById('newRxDoctor').value = '';
        document.getElementById('newRxStartDate').value = '';
        await app.loadPrescriptions();
    };

    app.deletePrescription = async function (id) {
        if (!confirm('Delete this prescription and all its pickup history?')) return;
        const res = await fetch(`${app.API}/prescriptions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadPrescriptions();
    };

    app.togglePickups = async function (rxId) {
        const section = document.getElementById(`pickups-${rxId}`);
        const expandBtn = document.getElementById(`expand-${rxId}`);
        if (section.style.display === 'none') {
            section.style.display = '';
            expandBtn.innerHTML = '&#9660;';
            await app.loadPickups(rxId);
        } else {
            section.style.display = 'none';
            expandBtn.innerHTML = '&#9654;';
        }
    };

    app.loadPickups = async function (rxId) {
        const res = await fetch(`${app.API}/prescriptions/${rxId}/pickups`);
        if (!res.ok) return;
        const pickups = await res.json();
        const container = document.getElementById(`pickupList-${rxId}`);
        if (pickups.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:12px">No pickups logged.</div>';
            return;
        }
        container.innerHTML = pickups.map(p => {
            const meta = [];
            if (p.quantity) meta.push(p.quantity);
            if (p.pharmacy) meta.push(p.pharmacy);
            if (p.cost != null) meta.push('$' + parseFloat(p.cost).toFixed(2));
            return `<div class="pickup-item">
                <div class="pickup-info">
                    <span class="pickup-date">${app.formatDate(p.pickupDate)}</span>
                    ${meta.length ? `<span class="pickup-meta">${meta.map(m => app.escapeHtml(m)).join(' &middot; ')}</span>` : ''}
                    ${p.notes ? `<span class="pickup-meta">${app.escapeHtml(p.notes)}</span>` : ''}
                </div>
                <button class="delete-btn btn-sm" onclick="medDocsDeletePickup(${p.id}, ${rxId})">Delete</button>
            </div>`;
        }).join('');
    };

    app.addPickup = async function (rxId) {
        const date = document.getElementById(`pickupDate-${rxId}`).value;
        if (!date) {
            alert('Pickup date is required');
            return;
        }

        const costStr = document.getElementById(`pickupCost-${rxId}`).value;

        const res = await fetch(`${app.API}/prescriptions/${rxId}/pickups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pickupDate: date,
                quantity: document.getElementById(`pickupQty-${rxId}`).value.trim() || null,
                pharmacy: document.getElementById(`pickupPharmacy-${rxId}`).value.trim() || null,
                cost: costStr ? parseFloat(costStr) : null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to log pickup');
            return;
        }

        document.getElementById(`pickupDate-${rxId}`).value = '';
        document.getElementById(`pickupQty-${rxId}`).value = '';
        document.getElementById(`pickupPharmacy-${rxId}`).value = '';
        document.getElementById(`pickupCost-${rxId}`).value = '';
        await app.loadPickups(rxId);
        await app.loadPrescriptions();
    };

    app.deletePickup = async function (id, rxId) {
        if (!confirm('Delete this pickup record?')) return;
        const res = await fetch(`${app.API}/pickups/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadPickups(rxId);
        await app.loadPrescriptions();
    };

    app.editPrescription = function (id) {
        const rx = state.currentPrescriptions.find(r => r.id === id);
        if (!rx) return;

        const el = document.getElementById(`rx-${id}`);
        if (!el) return;

        const doctorOpts = '<option value="">Doctor (optional)</option>' +
            state.doctors.map(d => `<option value="${d.id}" ${d.id === rx.doctorId ? 'selected' : ''}>${app.escapeHtml(d.name)}</option>`).join('');

        const startDate = rx.startDate ? rx.startDate.split('T')[0] : '';
        const endDate = rx.endDate ? rx.endDate.split('T')[0] : '';

        el.innerHTML = `<div class="inline-edit-form" style="padding: 14px 18px;">
            <div class="inline-form-row">
                <input type="text" id="editRxMed-${id}" value="${app.escapeAttr(rx.medicationName)}" class="form-input" placeholder="Medication *" />
                <input type="text" id="editRxNumber-${id}" value="${app.escapeAttr(rx.rxNumber || '')}" class="form-input" placeholder="RX#" />
                <input type="text" id="editRxDosage-${id}" value="${app.escapeAttr(rx.dosage || '')}" class="form-input" placeholder="Dosage" />
                <input type="text" id="editRxFrequency-${id}" value="${app.escapeAttr(rx.frequency || '')}" class="form-input" placeholder="Frequency" />
                <select id="editRxDoctor-${id}" class="form-input">${doctorOpts}</select>
            </div>
            <div class="inline-form-row" style="margin-top: 8px;">
                <input type="date" id="editRxStart-${id}" value="${startDate}" class="form-input" title="Start date" />
                <input type="date" id="editRxEnd-${id}" value="${endDate}" class="form-input" title="End date" />
                <input type="text" id="editRxNotes-${id}" value="${app.escapeAttr(rx.notes || '')}" class="form-input" placeholder="Notes" />
                <label style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--text-secondary);">
                    <input type="checkbox" id="editRxActive-${id}" ${rx.isActive ? 'checked' : ''} /> Active
                </label>
                <button class="btn btn-primary btn-sm" onclick="medDocsSavePrescription(${id})">Save</button>
                <button class="btn btn-secondary btn-sm" onclick="medDocsCancelEditPrescription()">Cancel</button>
            </div>
        </div>`;
    };

    app.savePrescription = async function (id) {
        const medication = document.getElementById(`editRxMed-${id}`).value.trim();
        if (!medication) return;

        const doctorVal = document.getElementById(`editRxDoctor-${id}`).value;

        const res = await fetch(`${app.API}/prescriptions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                medicationName: medication,
                dosage: document.getElementById(`editRxDosage-${id}`).value.trim() || null,
                frequency: document.getElementById(`editRxFrequency-${id}`).value.trim() || null,
                doctorId: doctorVal ? parseInt(doctorVal) : null,
                startDate: document.getElementById(`editRxStart-${id}`).value || null,
                endDate: document.getElementById(`editRxEnd-${id}`).value || null,
                notes: document.getElementById(`editRxNotes-${id}`).value.trim() || null,
                isActive: document.getElementById(`editRxActive-${id}`).checked,
                rxNumber: document.getElementById(`editRxNumber-${id}`).value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to update prescription');
            return;
        }

        await app.loadPrescriptions();
    };

    window.medDocsAddPrescription = () => app.addPrescription();
    window.medDocsDeletePrescription = (id) => app.deletePrescription(id);
    window.medDocsTogglePickups = (rxId) => app.togglePickups(rxId);
    window.medDocsAddPickup = (rxId) => app.addPickup(rxId);
    window.medDocsDeletePickup = (id, rxId) => app.deletePickup(id, rxId);
    window.medDocsEditPrescription = (id) => app.editPrescription(id);
    window.medDocsSavePrescription = (id) => app.savePrescription(id);
    window.medDocsCancelEditPrescription = () => app.loadPrescriptions();
})(MedDocs);
