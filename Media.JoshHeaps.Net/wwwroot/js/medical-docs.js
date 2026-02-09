(function () {
    const API = '/api/medical-docs';
    let people = [];
    let doctors = [];
    let selectedPersonId = null;
    let activeTab = 'doctors';

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        await loadPeople();
        await loadDoctors();

        // Add person
        document.getElementById('addPersonBtn').addEventListener('click', addPerson);
        document.getElementById('newPersonName').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addPerson();
        });

        // Upload sub-tabs (file vs note)
        document.querySelectorAll('.upload-sub-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchUploadTab(btn.dataset.tab));
        });

        // File upload
        document.getElementById('browseBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        document.getElementById('fileInput').addEventListener('change', handleFileSelect);

        // Drag and drop
        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                uploadFiles(e.dataTransfer.files);
            }
        });

        // Save note
        document.getElementById('saveNoteBtn').addEventListener('click', saveNote);

        // Default state: only Doctors tab visible, no summary cards
        switchMainTab('doctors');
        updateTabStates();
    }

    // --- Main Tab Switching ---

    function switchMainTab(tabName) {
        // Person-scoped tabs require a person selection
        if (!selectedPersonId && tabName !== 'doctors') return;

        activeTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.main-tab').forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            if (panel.id === 'panel-' + tabName) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        // Update summary card highlights
        document.querySelectorAll('.summary-card').forEach(card => {
            if (card.dataset.tab === tabName) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    }

    function updateTabStates() {
        var personTabs = ['documents', 'conditions', 'prescriptions'];
        personTabs.forEach(function (tab) {
            var btn = document.querySelector('.main-tab[data-tab="' + tab + '"]');
            if (btn) {
                if (selectedPersonId) {
                    btn.classList.remove('disabled');
                } else {
                    btn.classList.add('disabled');
                }
            }
        });
    }

    // --- Upload Sub-Tab Switching (file vs note) ---

    function switchUploadTab(tab) {
        document.querySelectorAll('.upload-sub-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.add-form-collapsible .tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector(`.upload-sub-tabs .tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`tab-${tab}`).classList.add('active');
    }

    // --- Summary Cards ---

    function updateSummaryCount(id, count) {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    }

    // --- Collapsible Add Forms ---

    function toggleAddForm(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const collapsible = panel.querySelector('.add-form-collapsible');
        if (collapsible) {
            collapsible.classList.toggle('open');
        }
    }

    // --- People ---

    async function loadPeople() {
        const res = await fetch(`${API}/people`);
        if (!res.ok) return;
        people = await res.json();
        renderPeople();
    }

    function renderPeople() {
        const container = document.getElementById('peopleList');
        container.innerHTML = people.map(p =>
            `<button class="person-pill ${p.id === selectedPersonId ? 'active' : ''}" onclick="medDocsSelectPerson(${p.id})">${escapeHtml(p.name)}</button>`
        ).join('');
    }

    async function addPerson() {
        const input = document.getElementById('newPersonName');
        const name = input.value.trim();
        if (!name) return;

        const res = await fetch(`${API}/people`, {
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
        await loadPeople();
        selectPerson(person.id);
    }

    function selectPerson(personId) {
        selectedPersonId = personId;
        renderPeople();

        // Show summary cards and enable person-scoped tabs
        document.getElementById('summaryCards').style.display = '';
        updateTabStates();

        // Load data for this person
        loadDocuments();
        loadConditions();
        loadPrescriptions();

        // Switch to Documents tab by default
        switchMainTab('documents');
    }

    // --- File Upload ---

    function handleFileSelect(e) {
        if (e.target.files.length > 0) {
            uploadFiles(e.target.files);
        }
    }

    async function uploadFiles(files) {
        const queue = document.getElementById('uploadQueue');

        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'upload-item';
            item.innerHTML = `
                <div class="file-info">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <span class="file-size">${formatSize(file.size)}</span>
                </div>
                <span class="upload-status uploading">Uploading...</span>
            `;
            queue.appendChild(item);

            const statusEl = item.querySelector('.upload-status');

            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('personId', selectedPersonId);

                const title = document.getElementById('fileTitle').value.trim();
                const description = document.getElementById('fileDescription').value.trim();
                const date = document.getElementById('fileDate').value;
                const classification = document.getElementById('fileClassification').value;

                if (title) formData.append('title', title);
                if (description) formData.append('description', description);
                if (date) formData.append('documentDate', date);
                if (classification) formData.append('classification', classification);

                const res = await fetch(`${API}/documents/upload`, {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    statusEl.textContent = 'Done';
                    statusEl.className = 'upload-status done';
                } else {
                    const err = await res.json().catch(() => ({}));
                    statusEl.textContent = err.error || 'Failed';
                    statusEl.className = 'upload-status error';
                }
            } catch {
                statusEl.textContent = 'Error';
                statusEl.className = 'upload-status error';
            }
        }

        // Clear fields after upload batch
        document.getElementById('fileTitle').value = '';
        document.getElementById('fileDescription').value = '';
        document.getElementById('fileDate').value = '';
        document.getElementById('fileClassification').value = '';
        document.getElementById('fileInput').value = '';

        await loadDocuments();
    }

    // --- Notes ---

    async function saveNote() {
        const title = document.getElementById('noteTitle').value.trim();
        const description = document.getElementById('noteDescription').value.trim();
        const date = document.getElementById('noteDate').value || null;
        const classification = document.getElementById('noteClassification').value || null;

        if (!title) {
            alert('Title is required');
            return;
        }

        const res = await fetch(`${API}/documents/note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: selectedPersonId,
                title,
                description,
                documentDate: date,
                classification
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to save note');
            return;
        }

        document.getElementById('noteTitle').value = '';
        document.getElementById('noteDescription').value = '';
        document.getElementById('noteDate').value = '';
        document.getElementById('noteClassification').value = '';

        await loadDocuments();
    }

    // --- Documents ---

    async function loadDocuments() {
        if (!selectedPersonId) return;

        const res = await fetch(`${API}/documents?personId=${selectedPersonId}`);
        if (!res.ok) return;

        const docs = await res.json();
        renderDocuments(docs);
        updateSummaryCount('summaryDocCount', docs.length);
    }

    function renderDocuments(docs) {
        const container = document.getElementById('documentsList');
        const countEl = document.getElementById('docCount');
        countEl.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;

        // Show/hide Process All button based on unprocessed docs
        const unprocessedCount = docs.filter(d => !d.aiProcessed).length;
        const processAllBtn = document.getElementById('processAllBtn');
        if (processAllBtn) {
            processAllBtn.style.display = unprocessedCount > 0 ? '' : 'none';
            processAllBtn.textContent = `Process All with AI (${unprocessedCount})`;
        }

        if (docs.length === 0) {
            container.innerHTML = '<div class="empty-state">No documents yet. Upload a file or create a note above.</div>';
            return;
        }

        container.innerHTML = docs.map(doc => {
            const icon = getDocIcon(doc);
            const displayTitle = doc.title || doc.fileName || 'Untitled';
            const meta = [];

            if (doc.documentDate) {
                meta.push(formatDate(doc.documentDate));
            }
            if (doc.documentType === 'file' && doc.fileSize) {
                meta.push(formatSize(doc.fileSize));
            }
            if (doc.documentType === 'note') {
                meta.push('Note');
            }

            const classificationBadge = doc.classification
                ? `<span class="doc-classification">${escapeHtml(formatClassification(doc.classification))}</span>`
                : '';

            const aiStatusBadge = getAiStatusBadge(doc);

            const downloadBtn = doc.documentType === 'file'
                ? `<button onclick="medDocsDownload(${doc.id}, '${escapeAttr(doc.fileName || 'download')}')">Download</button>`
                : '';

            const processBtn = !doc.aiProcessed
                ? `<button class="ai-process-btn" onclick="medDocsProcess(${doc.id}, this)">Process AI</button>`
                : '';

            return `<div class="doc-item">
                <div class="doc-type-icon">${icon}</div>
                <div class="doc-info">
                    <div class="doc-title">${escapeHtml(displayTitle)}</div>
                    <div class="doc-meta">
                        <span>${meta.join(' &middot; ')}</span>
                        ${classificationBadge}
                        ${aiStatusBadge}
                    </div>
                    ${doc.description && doc.documentType === 'note' ? `<div class="doc-meta" style="margin-top:4px">${escapeHtml(truncate(doc.description, 150))}</div>` : ''}
                </div>
                <div class="doc-actions">
                    ${processBtn}
                    ${downloadBtn}
                    <button class="delete-btn" onclick="medDocsDelete(${doc.id})">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    function getAiStatusBadge(doc) {
        if (doc.aiProcessed) {
            return '<span class="ai-badge ai-done" title="AI processed">AI</span>';
        }
        return '<span class="ai-badge ai-pending" title="Not yet processed">No AI</span>';
    }

    // --- Doctors ---

    async function loadDoctors() {
        const res = await fetch(`${API}/doctors`);
        if (!res.ok) return;
        doctors = await res.json();
        renderDoctors();
        populateDoctorDropdown();
        updateSummaryCount('summaryDrCount', doctors.length);
    }

    function renderDoctors() {
        const container = document.getElementById('doctorsList');
        if (doctors.length === 0) {
            container.innerHTML = '<div class="empty-state">No doctors added yet.</div>';
            return;
        }
        container.innerHTML = doctors.map(doc => {
            const details = [doc.specialty, doc.phone, doc.address].filter(Boolean);
            return `<div class="doctor-card" id="doctor-${doc.id}">
                <div class="doctor-info">
                    <div class="doctor-name">${escapeHtml(doc.name)}</div>
                    <div class="doctor-details">${details.map(d => escapeHtml(d)).join(' &middot; ')}</div>
                    ${doc.notes ? `<div class="doctor-notes">${escapeHtml(doc.notes)}</div>` : ''}
                </div>
                <div class="doc-actions">
                    <button onclick="medDocsEditDoctor(${doc.id})">Edit</button>
                    <button class="delete-btn" onclick="medDocsDeleteDoctor(${doc.id})">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    function populateDoctorDropdown() {
        const select = document.getElementById('newRxDoctor');
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">Doctor (optional)</option>' +
            doctors.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
        select.value = currentVal;
    }

    async function addDoctor() {
        const name = document.getElementById('newDoctorName').value.trim();
        if (!name) return;

        const res = await fetch(`${API}/doctors`, {
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
        await loadDoctors();
    }

    async function deleteDoctor(id) {
        if (!confirm('Delete this doctor?')) return;
        const res = await fetch(`${API}/doctors/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await loadDoctors();
    }

    async function editDoctor(id) {
        const doc = doctors.find(d => d.id === id);
        if (!doc) return;

        const card = document.getElementById(`doctor-${id}`);
        if (!card) return;

        card.innerHTML = `<div class="inline-edit-form">
            <div class="inline-form-row">
                <input type="text" id="editDoctorName-${id}" value="${escapeAttr(doc.name)}" class="form-input" placeholder="Name *" />
                <input type="text" id="editDoctorSpecialty-${id}" value="${escapeAttr(doc.specialty || '')}" class="form-input" placeholder="Specialty" />
                <input type="text" id="editDoctorPhone-${id}" value="${escapeAttr(doc.phone || '')}" class="form-input" placeholder="Phone" />
                <input type="text" id="editDoctorAddress-${id}" value="${escapeAttr(doc.address || '')}" class="form-input" placeholder="Address" />
                <button class="btn btn-primary btn-sm" onclick="medDocsSaveDoctor(${id})">Save</button>
                <button class="btn btn-secondary btn-sm" onclick="medDocsCancelEditDoctor()">Cancel</button>
            </div>
        </div>`;
    }

    async function saveDoctor(id) {
        const name = document.getElementById(`editDoctorName-${id}`).value.trim();
        if (!name) return;

        const res = await fetch(`${API}/doctors/${id}`, {
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

        await loadDoctors();
    }

    // --- Conditions ---

    async function loadConditions() {
        if (!selectedPersonId) return;
        const res = await fetch(`${API}/conditions?personId=${selectedPersonId}`);
        if (!res.ok) return;
        const conditions = await res.json();
        renderConditions(conditions);
        updateSummaryCount('summaryCondCount', conditions.length);
    }

    function renderConditions(conditions) {
        const container = document.getElementById('conditionsList');
        if (conditions.length === 0) {
            container.innerHTML = '<div class="empty-state">No conditions tracked yet.</div>';
            return;
        }
        container.innerHTML = conditions.map(c => {
            const meta = [];
            if (c.diagnosedDate) meta.push('Diagnosed: ' + formatDate(c.diagnosedDate));
            const statusBadge = c.isActive
                ? '<span class="badge-active">Active</span>'
                : '<span class="badge-inactive">Inactive</span>';
            return `<div class="condition-item" id="condition-${c.id}">
                <div class="condition-info">
                    <div class="condition-name">${escapeHtml(c.name)} ${statusBadge}</div>
                    ${meta.length ? `<div class="condition-meta">${meta.join(' &middot; ')}</div>` : ''}
                    ${c.notes ? `<div class="condition-meta">${escapeHtml(c.notes)}</div>` : ''}
                </div>
                <div class="doc-actions">
                    <button onclick="medDocsToggleCondition(${c.id}, ${!c.isActive})">${c.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button class="delete-btn" onclick="medDocsDeleteCondition(${c.id})">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    async function addCondition() {
        const name = document.getElementById('newConditionName').value.trim();
        if (!name) return;

        const res = await fetch(`${API}/conditions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: selectedPersonId,
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
        await loadConditions();
    }

    async function toggleConditionActive(id, isActive) {
        const res = await fetch(`${API}/conditions?personId=${selectedPersonId}`);
        if (!res.ok) return;
        const conditions = await res.json();
        const condition = conditions.find(c => c.id === id);
        if (!condition) return;

        const updateRes = await fetch(`${API}/conditions/${id}`, {
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

        await loadConditions();
    }

    async function deleteCondition(id) {
        if (!confirm('Delete this condition?')) return;
        const res = await fetch(`${API}/conditions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await loadConditions();
    }

    // --- Prescriptions ---

    async function loadPrescriptions() {
        if (!selectedPersonId) return;
        const res = await fetch(`${API}/prescriptions?personId=${selectedPersonId}`);
        if (!res.ok) return;
        const prescriptions = await res.json();
        renderPrescriptions(prescriptions);
        updateSummaryCount('summaryRxCount', prescriptions.length);
    }

    function renderPrescriptions(prescriptions) {
        const container = document.getElementById('prescriptionsList');
        if (prescriptions.length === 0) {
            container.innerHTML = '<div class="empty-state">No prescriptions tracked yet.</div>';
            return;
        }
        container.innerHTML = prescriptions.map(rx => {
            const meta = [];
            if (rx.dosage) meta.push(rx.dosage);
            if (rx.frequency) meta.push(rx.frequency);
            if (rx.doctorName) meta.push('Dr. ' + rx.doctorName);
            if (rx.startDate) meta.push('Started: ' + formatDate(rx.startDate));
            const lastPickup = rx.lastPickupDate ? formatDate(rx.lastPickupDate) : 'None';
            const statusBadge = rx.isActive
                ? '<span class="badge-active">Active</span>'
                : '<span class="badge-inactive">Inactive</span>';
            return `<div class="prescription-item" id="rx-${rx.id}">
                <div class="prescription-header" onclick="medDocsTogglePickups(${rx.id})">
                    <div class="prescription-info">
                        <div class="prescription-name">
                            <span class="expand-btn" id="expand-${rx.id}">&#9654;</span>
                            ${escapeHtml(rx.medicationName)} ${statusBadge}
                        </div>
                        <div class="prescription-meta">${meta.map(m => escapeHtml(m)).join(' &middot; ')}</div>
                        <div class="prescription-meta">Last pickup: ${escapeHtml(lastPickup)}</div>
                    </div>
                    <div class="doc-actions" onclick="event.stopPropagation()">
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
    }

    async function addPrescription() {
        const medication = document.getElementById('newRxMedication').value.trim();
        if (!medication) return;

        const doctorId = document.getElementById('newRxDoctor').value;

        const res = await fetch(`${API}/prescriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: selectedPersonId,
                medicationName: medication,
                dosage: document.getElementById('newRxDosage').value.trim() || null,
                frequency: document.getElementById('newRxFrequency').value.trim() || null,
                doctorId: doctorId ? parseInt(doctorId) : null,
                startDate: document.getElementById('newRxStartDate').value || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add prescription');
            return;
        }

        document.getElementById('newRxMedication').value = '';
        document.getElementById('newRxDosage').value = '';
        document.getElementById('newRxFrequency').value = '';
        document.getElementById('newRxDoctor').value = '';
        document.getElementById('newRxStartDate').value = '';
        await loadPrescriptions();
    }

    async function deletePrescription(id) {
        if (!confirm('Delete this prescription and all its pickup history?')) return;
        const res = await fetch(`${API}/prescriptions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await loadPrescriptions();
    }

    async function togglePickups(rxId) {
        const section = document.getElementById(`pickups-${rxId}`);
        const expandBtn = document.getElementById(`expand-${rxId}`);
        if (section.style.display === 'none') {
            section.style.display = '';
            expandBtn.innerHTML = '&#9660;';
            await loadPickups(rxId);
        } else {
            section.style.display = 'none';
            expandBtn.innerHTML = '&#9654;';
        }
    }

    async function loadPickups(rxId) {
        const res = await fetch(`${API}/prescriptions/${rxId}/pickups`);
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
                    <span class="pickup-date">${formatDate(p.pickupDate)}</span>
                    ${meta.length ? `<span class="pickup-meta">${meta.map(m => escapeHtml(m)).join(' &middot; ')}</span>` : ''}
                    ${p.notes ? `<span class="pickup-meta">${escapeHtml(p.notes)}</span>` : ''}
                </div>
                <button class="delete-btn btn-sm" onclick="medDocsDeletePickup(${p.id}, ${rxId})">Delete</button>
            </div>`;
        }).join('');
    }

    async function addPickup(rxId) {
        const date = document.getElementById(`pickupDate-${rxId}`).value;
        if (!date) {
            alert('Pickup date is required');
            return;
        }

        const costStr = document.getElementById(`pickupCost-${rxId}`).value;

        const res = await fetch(`${API}/prescriptions/${rxId}/pickups`, {
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
        await loadPickups(rxId);
        await loadPrescriptions();
    }

    async function deletePickup(id, rxId) {
        if (!confirm('Delete this pickup record?')) return;
        const res = await fetch(`${API}/pickups/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await loadPickups(rxId);
        await loadPrescriptions();
    }

    // --- Helpers ---

    function getDocIcon(doc) {
        if (doc.documentType === 'note') {
            return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
        }
        const mime = (doc.mimeType || '').toLowerCase();
        if (mime.startsWith('image/')) {
            return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
        }
        if (mime === 'application/pdf') {
            return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
        }
        // Default file icon
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
    }

    function formatClassification(c) {
        return c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString();
    }

    function truncate(str, max) {
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
    }

    // --- Global functions for inline handlers ---

    window.medDocsSelectPerson = function (id) {
        selectPerson(id);
    };

    window.medDocsSwitchTab = function (tabName) {
        switchMainTab(tabName);
    };

    window.medDocsToggleAddForm = function (panelId) {
        toggleAddForm(panelId);
    };

    window.medDocsDownload = function (id, fileName) {
        const a = document.createElement('a');
        a.href = `${API}/documents/${id}/download`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    window.medDocsDelete = async function (id) {
        if (!confirm('Delete this document? This cannot be undone.')) return;

        const res = await fetch(`${API}/documents/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await loadDocuments();
    };

    window.medDocsProcess = async function (id, btn) {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Processing...';
            btn.classList.add('processing');
        }

        try {
            const res = await fetch(`${API}/documents/${id}/process`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || 'Failed to start processing');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Process AI';
                    btn.classList.remove('processing');
                }
                return;
            }

            if (btn) {
                btn.textContent = 'Queued';
            }

            // Reload after a delay to pick up results
            setTimeout(() => loadDocuments(), 5000);
        } catch {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Process AI';
                btn.classList.remove('processing');
            }
        }
    };

    // --- Doctor globals ---

    window.medDocsAddDoctor = function () { addDoctor(); };
    window.medDocsDeleteDoctor = function (id) { deleteDoctor(id); };
    window.medDocsEditDoctor = function (id) { editDoctor(id); };
    window.medDocsSaveDoctor = function (id) { saveDoctor(id); };
    window.medDocsCancelEditDoctor = function () { renderDoctors(); };

    // --- Condition globals ---

    window.medDocsAddCondition = function () { addCondition(); };
    window.medDocsDeleteCondition = function (id) { deleteCondition(id); };
    window.medDocsToggleCondition = function (id, isActive) { toggleConditionActive(id, isActive); };

    // --- Prescription globals ---

    window.medDocsAddPrescription = function () { addPrescription(); };
    window.medDocsDeletePrescription = function (id) { deletePrescription(id); };
    window.medDocsTogglePickups = function (rxId) { togglePickups(rxId); };
    window.medDocsAddPickup = function (rxId) { addPickup(rxId); };
    window.medDocsDeletePickup = function (id, rxId) { deletePickup(id, rxId); };

    window.medDocsProcessAll = async function () {
        const btn = document.getElementById('processAllBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Processing...';
        }

        try {
            const res = await fetch(`${API}/documents/process-all`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || 'Failed to start processing');
                if (btn) {
                    btn.disabled = false;
                }
                await loadDocuments();
                return;
            }

            const data = await res.json();
            if (btn) {
                btn.textContent = `Queued ${data.queued} docs`;
            }

            // Reload after a delay to pick up results
            setTimeout(() => loadDocuments(), 8000);
        } catch {
            if (btn) {
                btn.disabled = false;
            }
            await loadDocuments();
        }
    };
})();
