(function (app) {
    const { state } = app;

    // --- Filters ---

    app.buildFilterQuery = function () {
        const params = new URLSearchParams();
        if (state.selectedPersonId) params.set('personId', state.selectedPersonId);

        const search = document.getElementById('filterSearch').value.trim();
        if (search) params.set('search', search);

        const classification = document.getElementById('filterClassification').value;
        if (classification) params.set('classification', classification);

        const docType = document.getElementById('filterDocType').value;
        if (docType) params.set('documentType', docType);

        const doctor = document.getElementById('filterDoctor').value;
        if (doctor) params.set('doctorId', doctor);

        const tag = document.getElementById('filterTag').value;
        if (tag) params.set('tagId', tag);

        const condition = document.getElementById('filterCondition').value;
        if (condition) params.set('conditionId', condition);

        const fromDate = document.getElementById('filterFromDate').value;
        if (fromDate) params.set('fromDate', fromDate);

        const toDate = document.getElementById('filterToDate').value;
        if (toDate) params.set('toDate', toDate);

        return params.toString();
    };

    app.clearFilters = function (reload = true) {
        document.getElementById('filterSearch').value = '';
        document.getElementById('filterClassification').value = '';
        document.getElementById('filterDocType').value = '';
        document.getElementById('filterDoctor').value = '';
        document.getElementById('filterTag').value = '';
        document.getElementById('filterCondition').value = '';
        document.getElementById('filterFromDate').value = '';
        document.getElementById('filterToDate').value = '';
        if (reload) app.loadDocuments();
    };

    app.loadFilterTags = async function () {
        const personParam = state.selectedPersonId ? `?personId=${state.selectedPersonId}` : '';
        const res = await fetch(`${app.API}/tags${personParam}`);
        if (!res.ok) return;
        const tags = await res.json();
        const select = document.getElementById('filterTag');
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Tags</option>' +
            tags.map(t => `<option value="${t.id}">${app.escapeHtml(t.name)}</option>`).join('');
        select.value = currentVal;
    };

    app.loadFilterConditions = async function () {
        const personParam = state.selectedPersonId ? `?personId=${state.selectedPersonId}` : '';
        const res = await fetch(`${app.API}/conditions${personParam}`);
        if (!res.ok) return;
        const conditions = await res.json();
        const select = document.getElementById('filterCondition');
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Conditions</option>' +
            conditions.map(c => `<option value="${c.id}">${app.escapeHtml(c.name)}</option>`).join('');
        select.value = currentVal;
    };

    app.populateFilterDoctorDropdown = function () {
        const select = document.getElementById('filterDoctor');
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Doctors</option>' +
            state.doctors.map(d => `<option value="${d.id}">${app.escapeHtml(d.name)}</option>`).join('');
        select.value = currentVal;
    };

    // --- Viewer ---

    app.getViewerType = function (doc) {
        if (doc.documentType === 'note') return 'text';
        const mime = (doc.mimeType || '').toLowerCase();
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('text/')) return 'text';
        if (mime === 'application/pdf') return 'pdf';
        return null;
    };

    // --- Documents ---

    app.loadDocuments = async function () {
        const query = app.buildFilterQuery();
        const res = await fetch(`${app.API}/documents/search?${query}`);
        if (!res.ok) return;

        const docs = await res.json();
        state.currentDocuments = docs;
        app.renderDocuments(docs);
        app.updateSummaryCount('summaryDocCount', docs.length);
    };

    app.renderDocuments = function (docs) {
        const container = document.getElementById('documentsList');
        const countEl = document.getElementById('docCount');
        countEl.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;

        const unprocessedCount = docs.filter(d => !d.aiProcessed).length;
        const processAllBtn = document.getElementById('processAllBtn');
        if (processAllBtn) {
            processAllBtn.style.display = unprocessedCount > 0 ? '' : 'none';
            processAllBtn.textContent = `Process All with AI (${unprocessedCount})`;
        }
        const batchModeBtn = document.getElementById('batchModeBtn');
        if (batchModeBtn) {
            batchModeBtn.style.display = docs.length > 0 ? '' : 'none';
        }

        if (docs.length === 0) {
            container.innerHTML = '<div class="empty-state">No documents yet. Upload a file or create a note above.</div>';
            return;
        }

        container.innerHTML = docs.map(doc => {
            const icon = app.getDocIcon(doc);
            const displayTitle = doc.title || doc.fileName || 'Untitled';
            const meta = [];

            if (doc.documentDate) {
                meta.push(app.formatDate(doc.documentDate));
            }
            if (doc.documentType === 'file' && doc.fileSize) {
                meta.push(app.formatSize(doc.fileSize));
            }
            if (doc.documentType === 'note') {
                meta.push('Note');
            }

            const classificationBadge = doc.classification
                ? `<span class="doc-classification">${app.escapeHtml(app.formatClassification(doc.classification))}</span>`
                : '';

            const aiStatusBadge = app.getAiStatusBadge(doc);

            const viewerType = app.getViewerType(doc);
            const viewBtn = viewerType
                ? `<button onclick="event.stopPropagation(); medDocsView(${doc.id})">View</button>`
                : '';

            const downloadBtn = doc.documentType === 'file'
                ? `<button onclick="event.stopPropagation(); medDocsDownload(${doc.id}, '${app.escapeAttr(doc.fileName || 'download')}')">Download</button>`
                : '';

            const processBtn = !doc.aiProcessed
                ? `<button class="ai-process-btn" onclick="event.stopPropagation(); medDocsProcess(${doc.id}, this)">Process AI</button>`
                : '';

            const batchCheckbox = state.batchSelectMode
                ? `<input type="checkbox" class="batch-checkbox" id="batch-cb-${doc.id}" ${state.selectedDocIds.has(doc.id) ? 'checked' : ''} onclick="event.stopPropagation(); medDocsToggleDetail(${doc.id})">`
                : '';
            const batchClass = state.batchSelectMode && state.selectedDocIds.has(doc.id) ? ' batch-selected' : '';

            return `<div class="doc-item-wrapper" id="doc-wrapper-${doc.id}">
                <div class="doc-item${batchClass}" onclick="medDocsToggleDetail(${doc.id})" style="cursor:pointer">
                    ${batchCheckbox}
                    <div class="doc-type-icon">${icon}</div>
                    <div class="doc-info">
                        <div class="doc-title">
                            <span class="expand-btn" id="doc-expand-${doc.id}">&#9654;</span>
                            ${app.personBadge(doc.personId)}${app.escapeHtml(displayTitle)}
                        </div>
                        <div class="doc-meta">
                            <span>${meta.join(' &middot; ')}</span>
                            ${classificationBadge}
                            ${aiStatusBadge}
                        </div>
                        ${doc.description && doc.documentType === 'note' ? `<div class="doc-meta" style="margin-top:4px">${app.escapeHtml(app.truncate(doc.description, 150))}</div>` : ''}
                    </div>
                    <div class="doc-actions" onclick="event.stopPropagation()">
                        ${processBtn}
                        ${viewBtn}
                        ${downloadBtn}
                        <button class="delete-btn" onclick="medDocsDelete(${doc.id})">Delete</button>
                    </div>
                </div>
                <div class="doc-detail-panel" id="doc-detail-${doc.id}" style="display:none"></div>
            </div>`;
        }).join('');
    };

    // --- File Upload ---

    app.handleFileSelect = function (e) {
        if (e.target.files.length > 0) {
            app.uploadFiles(e.target.files);
        }
    };

    app.uploadFiles = async function (files) {
        const queue = document.getElementById('uploadQueue');

        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'upload-item';
            item.innerHTML = `
                <div class="file-info">
                    <span class="file-name">${app.escapeHtml(file.name)}</span>
                    <span class="file-size">${app.formatSize(file.size)}</span>
                </div>
                <span class="upload-status uploading">Uploading...</span>
            `;
            queue.appendChild(item);

            const statusEl = item.querySelector('.upload-status');

            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('personId', state.selectedPersonId);

                const title = document.getElementById('fileTitle').value.trim();
                const description = document.getElementById('fileDescription').value.trim();
                const date = document.getElementById('fileDate').value;
                const classification = document.getElementById('fileClassification').value;

                if (title) formData.append('title', title);
                if (description) formData.append('description', description);
                if (date) formData.append('documentDate', date);
                if (classification) formData.append('classification', classification);

                const res = await fetch(`${app.API}/documents/upload`, {
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

        document.getElementById('fileTitle').value = '';
        document.getElementById('fileDescription').value = '';
        document.getElementById('fileDate').value = '';
        document.getElementById('fileClassification').value = '';
        document.getElementById('fileInput').value = '';

        await app.loadDocuments();
    };

    // --- Notes ---

    app.saveNote = async function () {
        const title = document.getElementById('noteTitle').value.trim();
        const description = document.getElementById('noteDescription').value.trim();
        const date = document.getElementById('noteDate').value || null;
        const classification = document.getElementById('noteClassification').value || null;

        if (!title) {
            alert('Title is required');
            return;
        }

        const res = await fetch(`${app.API}/documents/note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: state.selectedPersonId,
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

        await app.loadDocuments();
    };

    // --- Globals ---

    window.medDocsDownload = function (id, fileName) {
        const a = document.createElement('a');
        a.href = `${app.API}/documents/${id}/download`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // --- Document Viewer ---

    let currentBlobUrl = null;

    window.medDocsView = async function (id) {
        const doc = state.currentDocuments.find(d => d.id === id);
        if (!doc) return;

        const viewerType = app.getViewerType(doc);
        if (!viewerType) return;

        const overlay = document.getElementById('docViewerOverlay');
        const title = document.getElementById('docViewerTitle');
        const body = document.getElementById('docViewerBody');

        title.textContent = doc.title || doc.fileName || 'Untitled';
        body.innerHTML = '<div class="doc-viewer-loading">Loading...</div>';
        overlay.style.display = '';
        document.body.style.overflow = 'hidden';

        if (doc.documentType === 'note') {
            body.innerHTML = `<pre class="doc-viewer-text">${app.escapeHtml(doc.description || '')}</pre>`;
            return;
        }

        try {
            const res = await fetch(`${app.API}/documents/${id}/download`);
            if (!res.ok) {
                body.innerHTML = '<div class="doc-viewer-error">Failed to load document.</div>';
                return;
            }

            const blob = await res.blob();
            currentBlobUrl = URL.createObjectURL(blob);

            if (viewerType === 'image') {
                body.innerHTML = `<img class="doc-viewer-image" src="${currentBlobUrl}" alt="${app.escapeAttr(doc.title || doc.fileName || '')}" />`;
            } else if (viewerType === 'audio') {
                body.innerHTML = `<audio class="doc-viewer-audio" controls src="${currentBlobUrl}"></audio>`;
            } else if (viewerType === 'pdf') {
                body.innerHTML = `<iframe class="doc-viewer-pdf" src="${currentBlobUrl}"></iframe>`;
            } else if (viewerType === 'text') {
                const text = await blob.text();
                body.innerHTML = `<pre class="doc-viewer-text">${app.escapeHtml(text)}</pre>`;
                URL.revokeObjectURL(currentBlobUrl);
                currentBlobUrl = null;
            }
        } catch {
            body.innerHTML = '<div class="doc-viewer-error">Error loading document.</div>';
        }
    };

    window.medDocsCloseViewer = function (event) {
        if (event && event.target !== event.currentTarget) return;
        const overlay = document.getElementById('docViewerOverlay');
        overlay.style.display = 'none';
        document.getElementById('docViewerBody').innerHTML = '';
        document.body.style.overflow = '';
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }
    };

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('docViewerOverlay');
            if (overlay && overlay.style.display !== 'none') {
                window.medDocsCloseViewer();
            }
        }
    });

    window.medDocsDelete = async function (id) {
        if (!confirm('Delete this document? This cannot be undone.')) return;

        const res = await fetch(`${app.API}/documents/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadDocuments();
    };

    window.medDocsProcess = async function (id, btn) {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Processing...';
            btn.classList.add('processing');
        }

        try {
            const res = await fetch(`${app.API}/documents/${id}/process`, { method: 'POST' });
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

            setTimeout(() => app.loadDocuments(), 5000);
        } catch {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Process AI';
                btn.classList.remove('processing');
            }
        }
    };

    window.medDocsProcessAll = async function () {
        const btn = document.getElementById('processAllBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Processing...';
        }

        try {
            const res = await fetch(`${app.API}/documents/process-all`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || 'Failed to start processing');
                if (btn) {
                    btn.disabled = false;
                }
                await app.loadDocuments();
                return;
            }

            const data = await res.json();
            if (btn) {
                btn.textContent = `Queued ${data.queued} docs`;
            }

            setTimeout(() => app.loadDocuments(), 8000);
        } catch {
            if (btn) {
                btn.disabled = false;
            }
            await app.loadDocuments();
        }
    };

    // --- Document Detail Panel ---

    app.toggleDetail = function (docId) {
        const panel = document.getElementById(`doc-detail-${docId}`);
        const arrow = document.getElementById(`doc-expand-${docId}`);
        const wrapper = document.getElementById(`doc-wrapper-${docId}`);
        if (!panel) return;

        if (panel.style.display === 'none') {
            panel.style.display = '';
            if (arrow) arrow.innerHTML = '&#9660;';
            if (wrapper) wrapper.classList.add('expanded');
            app.loadDocumentDetail(docId);
        } else {
            panel.style.display = 'none';
            if (arrow) arrow.innerHTML = '&#9654;';
            if (wrapper) wrapper.classList.remove('expanded');
        }
    };

    app.loadDocumentDetail = async function (docId) {
        const panel = document.getElementById(`doc-detail-${docId}`);
        if (!panel) return;

        panel.innerHTML = '<div style="padding:16px;color:var(--text-secondary)">Loading...</div>';

        try {
            const [docRes, tagsRes] = await Promise.all([
                fetch(`${app.API}/documents/${docId}`),
                fetch(`${app.API}/documents/${docId}/tags`)
            ]);

            if (!docRes.ok) {
                panel.innerHTML = '<div style="padding:16px;color:var(--danger)">Failed to load document details.</div>';
                return;
            }

            const doc = await docRes.json();
            const tags = tagsRes.ok ? await tagsRes.json() : [];

            const classOptions = ['', 'receipt', 'lab_result', 'prescription', 'imaging', 'dr_note', 'insurance', 'referral', 'discharge', 'recording', 'other']
                .map(c => `<option value="${c}" ${doc.classification === c ? 'selected' : ''}>${c ? app.formatClassification(c) : 'None'}</option>`).join('');

            const doctorOpts = '<option value="">None</option>' +
                state.doctors.map(d => `<option value="${d.id}" ${d.id === doc.doctorId ? 'selected' : ''}>${app.escapeHtml(d.name)}</option>`).join('');

            const docDate = doc.documentDate ? doc.documentDate.split('T')[0] : '';

            const tagBadges = tags.length > 0
                ? tags.map(t => `<span class="doc-classification" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-primary)">${app.escapeHtml(t.name)}</span>`).join(' ')
                : '<span style="color:var(--text-secondary)">No tags</span>';

            const readonlyInfo = [];
            if (doc.fileName) readonlyInfo.push(`<span>File: ${app.escapeHtml(doc.fileName)}</span>`);
            if (doc.fileSize) readonlyInfo.push(`<span>Size: ${app.formatSize(doc.fileSize)}</span>`);
            if (doc.createdAt) readonlyInfo.push(`<span>Created: ${app.formatDate(doc.createdAt)}</span>`);
            if (doc.aiProcessedAt) readonlyInfo.push(`<span>AI Processed: ${app.formatDate(doc.aiProcessedAt)}</span>`);

            panel.innerHTML = `<div class="doc-detail-content">
                <div class="doc-detail-row-inline">
                    <div>
                        <div class="doc-detail-label">Title</div>
                        <input type="text" id="detailTitle-${docId}" value="${app.escapeAttr(doc.title || '')}" class="form-input" style="width:100%" placeholder="Title" />
                    </div>
                    <div>
                        <div class="doc-detail-label">Date</div>
                        <input type="date" id="detailDate-${docId}" value="${docDate}" class="form-input" style="width:100%" />
                    </div>
                    <div>
                        <div class="doc-detail-label">Classification</div>
                        <select id="detailClass-${docId}" class="form-input" style="width:100%">${classOptions}</select>
                    </div>
                </div>
                <div class="doc-detail-row-inline">
                    <div>
                        <div class="doc-detail-label">Doctor</div>
                        <select id="detailDoctor-${docId}" class="form-input" style="width:100%">${doctorOpts}</select>
                    </div>
                    <div style="grid-column: span 2">
                        <div class="doc-detail-label">Description</div>
                        <textarea id="detailDesc-${docId}" class="form-input" style="width:100%;min-height:40px" placeholder="Description">${app.escapeHtml(doc.description || '')}</textarea>
                    </div>
                </div>
                <div style="margin-top:8px">
                    <button class="btn btn-primary btn-sm" onclick="medDocsSaveDocument(${docId})">Save Changes</button>
                </div>
                <div class="doc-detail-readonly">
                    <div class="doc-detail-label">Tags</div>
                    <div style="margin-bottom:8px">${tagBadges}</div>
                    <div class="doc-meta">${readonlyInfo.join(' &middot; ')}</div>
                </div>
                ${doc.extractedText ? `<details class="doc-extracted-text-wrapper">
                    <summary style="cursor:pointer;font-size:12px;color:var(--text-secondary);margin-top:8px">Extracted Text</summary>
                    <pre class="doc-extracted-text">${app.escapeHtml(doc.extractedText)}</pre>
                </details>` : ''}
            </div>`;
        } catch {
            panel.innerHTML = '<div style="padding:16px;color:var(--danger)">Error loading details.</div>';
        }
    };

    app.saveDocument = async function (docId) {
        const title = document.getElementById(`detailTitle-${docId}`).value.trim() || null;
        const description = document.getElementById(`detailDesc-${docId}`).value.trim() || null;
        const documentDate = document.getElementById(`detailDate-${docId}`).value || null;
        const classification = document.getElementById(`detailClass-${docId}`).value || null;
        const doctorVal = document.getElementById(`detailDoctor-${docId}`).value;
        const doctorId = doctorVal ? parseInt(doctorVal) : null;

        const res = await fetch(`${app.API}/documents/${docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, documentDate, classification, doctorId })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to update document');
            return;
        }

        await app.loadDocuments();
        // Re-expand the detail panel
        setTimeout(() => {
            const panel = document.getElementById(`doc-detail-${docId}`);
            if (panel) {
                panel.style.display = '';
                const arrow = document.getElementById(`doc-expand-${docId}`);
                if (arrow) arrow.innerHTML = '&#9660;';
                const wrapper = document.getElementById(`doc-wrapper-${docId}`);
                if (wrapper) wrapper.classList.add('expanded');
                app.loadDocumentDetail(docId);
            }
        }, 50);
    };

    // --- Batch Select Mode ---

    state.batchSelectMode = false;
    state.selectedDocIds = new Set();

    app.toggleBatchMode = function () {
        state.batchSelectMode = !state.batchSelectMode;
        state.selectedDocIds.clear();
        document.getElementById('batchToolbar').style.display = state.batchSelectMode ? '' : 'none';
        document.getElementById('selectAllCheckbox').checked = false;
        app.updateBatchCount();
        app.renderDocuments(state.currentDocuments);
    };

    app.toggleBatchSelect = function (docId) {
        if (state.selectedDocIds.has(docId)) {
            state.selectedDocIds.delete(docId);
        } else {
            state.selectedDocIds.add(docId);
        }
        app.updateBatchCount();
        const wrapper = document.getElementById(`doc-wrapper-${docId}`);
        if (wrapper) {
            const item = wrapper.querySelector('.doc-item');
            if (item) item.classList.toggle('batch-selected', state.selectedDocIds.has(docId));
        }
        const cb = document.getElementById(`batch-cb-${docId}`);
        if (cb) cb.checked = state.selectedDocIds.has(docId);
    };

    app.toggleSelectAll = function (checked) {
        state.selectedDocIds.clear();
        if (checked) {
            state.currentDocuments.forEach(d => state.selectedDocIds.add(d.id));
        }
        app.updateBatchCount();
        app.renderDocuments(state.currentDocuments);
    };

    app.updateBatchCount = function () {
        const el = document.getElementById('batchCount');
        if (el) el.textContent = state.selectedDocIds.size + ' selected';
    };

    app.processBatch = async function () {
        if (state.selectedDocIds.size === 0) {
            alert('No documents selected');
            return;
        }

        const res = await fetch(`${app.API}/documents/process-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentIds: [...state.selectedDocIds] })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to start batch processing');
            return;
        }

        const data = await res.json();
        alert(`Queued ${data.queued} document(s) for reprocessing`);
        app.toggleBatchMode();
        setTimeout(() => app.loadDocuments(), 5000);
    };

    window.medDocsToggleDetail = (id) => {
        if (state.batchSelectMode) {
            app.toggleBatchSelect(id);
            return;
        }
        app.toggleDetail(id);
    };
    window.medDocsSaveDocument = (id) => app.saveDocument(id);
    window.medDocsClearFilters = () => app.clearFilters();
    window.medDocsToggleBatchMode = () => app.toggleBatchMode();
    window.medDocsToggleSelectAll = (checked) => app.toggleSelectAll(checked);
    window.medDocsProcessBatch = () => app.processBatch();
})(MedDocs);
