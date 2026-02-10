(function (app) {
    const { state } = app;

    // --- Providers ---

    app.loadBills = async function () {
        if (!state.selectedPersonId) return;

        const [providersRes, summaryRes] = await Promise.all([
            fetch(`${app.API}/providers?personId=${state.selectedPersonId}`),
            fetch(`${app.API}/bills/summary?personId=${state.selectedPersonId}`)
        ]);

        if (providersRes.ok) {
            state.currentProviders = await providersRes.json();
        }

        if (summaryRes.ok) {
            const summary = await summaryRes.json();
            app.loadBillSummary(summary);
        }

        await app.renderProviders();
    };

    app.loadBillSummary = function (summary) {
        const oopEl = document.getElementById('summaryBillOop');
        const chargedEl = document.getElementById('summaryBillCharged');
        const dueEl = document.getElementById('summaryBillDue');
        if (oopEl) oopEl.textContent = app.formatCurrency(summary.totalPaid);
        if (chargedEl) chargedEl.textContent = 'of ' + app.formatCurrency(summary.totalCharged) + ' charged';
        if (dueEl) {
            if (summary.totalDue > 0) {
                dueEl.textContent = app.formatCurrency(summary.totalDue) + ' due';
                dueEl.style.display = '';
            } else {
                dueEl.textContent = '';
                dueEl.style.display = 'none';
            }
        }

        const container = document.getElementById('billSummarySection');
        if (!container) return;

        if (summary.totalCharged === 0) {
            container.innerHTML = '';
            return;
        }

        const yearRows = summary.byYear.map(y =>
            `<div class="cost-agg-row">
                <span>${y.year}</span>
                <span>${app.formatCurrency(y.total)} <span class="cost-agg-count">(${y.count} bill${y.count !== 1 ? 's' : ''})</span></span>
            </div>`
        ).join('');

        const providerRows = summary.byProvider.map(p =>
            `<div class="cost-agg-row">
                <span>${app.escapeHtml(p.providerName)}</span>
                <span>${app.formatCurrency(p.total)} <span class="cost-agg-count">(${p.count})</span></span>
            </div>`
        ).join('');

        container.innerHTML = `<div class="cost-aggregation" style="grid-template-columns: repeat(2, 1fr);">
            <div class="cost-agg-card">
                <div class="cost-agg-title">Charged by Year</div>
                ${yearRows || '<div class="empty-state" style="padding:8px">No data</div>'}
            </div>
            <div class="cost-agg-card">
                <div class="cost-agg-title">Charged by Provider</div>
                ${providerRows || '<div class="empty-state" style="padding:8px">No data</div>'}
            </div>
        </div>`;
    };

    app.renderProviders = async function () {
        const container = document.getElementById('providersList');
        if (!container) return;

        // Fetch unassigned bills
        const unassignedRes = await fetch(`${app.API}/bills?personId=${state.selectedPersonId}`);
        let unassignedBills = [];
        if (unassignedRes.ok) {
            const allBills = await unassignedRes.json();
            unassignedBills = allBills.filter(b => !b.providerId);
        }

        if (state.currentProviders.length === 0 && unassignedBills.length === 0) {
            container.innerHTML = '<div class="empty-state">No billing providers yet. Add a provider to start tracking bills and payments.</div>';
            return;
        }

        let html = state.currentProviders.map(p => {
            const statusClass = p.balance <= 0 ? 'paid' : p.totalPaid > 0 ? 'partial' : 'unpaid';
            const statusLabel = p.balance <= 0 ? 'Paid' : p.totalPaid > 0 ? 'Partial' : 'Unpaid';

            return `<div class="prescription-item provider-item" id="provider-${p.id}">
                <div class="prescription-header" onclick="medDocsToggleProvider(${p.id})">
                    <div class="prescription-info">
                        <div class="prescription-name">
                            <span class="expand-btn" id="provider-expand-${p.id}">&#9654;</span>
                            ${app.escapeHtml(p.name)}
                            <span class="bill-status ${statusClass}">${statusLabel}</span>
                        </div>
                        <div class="prescription-meta">
                            ${app.formatCurrency(p.totalCharged)} charged &middot; ${app.formatCurrency(p.totalPaid)} paid &middot; ${app.formatCurrency(p.balance)} balance
                            &middot; ${p.billCount} bill${p.billCount !== 1 ? 's' : ''}
                        </div>
                        ${p.notes ? `<div class="prescription-meta">${app.escapeHtml(p.notes)}</div>` : ''}
                    </div>
                    <div class="doc-actions" onclick="event.stopPropagation()">
                        <button class="delete-btn" onclick="medDocsDeleteProvider(${p.id})">Delete</button>
                    </div>
                </div>
                <div class="pickup-section" id="provider-details-${p.id}" style="display: none;"></div>
            </div>`;
        }).join('');

        if (unassignedBills.length > 0) {
            html += `<div class="prescription-item provider-item" id="provider-unassigned">
                <div class="prescription-header" onclick="medDocsToggleUnassigned()">
                    <div class="prescription-info">
                        <div class="prescription-name">
                            <span class="expand-btn" id="provider-expand-unassigned">&#9654;</span>
                            Bills without a provider
                        </div>
                        <div class="prescription-meta">${unassignedBills.length} bill${unassignedBills.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <div class="pickup-section" id="provider-details-unassigned" style="display: none;"></div>
            </div>`;
        }

        container.innerHTML = html;
    };

    app.toggleProvider = async function (providerId) {
        const section = document.getElementById(`provider-details-${providerId}`);
        const expandBtn = document.getElementById(`provider-expand-${providerId}`);
        if (section.style.display === 'none') {
            section.style.display = '';
            expandBtn.innerHTML = '&#9660;';
            await app.loadProviderDetails(providerId);
        } else {
            section.style.display = 'none';
            expandBtn.innerHTML = '&#9654;';
        }
    };

    app.toggleUnassigned = async function () {
        const section = document.getElementById('provider-details-unassigned');
        const expandBtn = document.getElementById('provider-expand-unassigned');
        if (section.style.display === 'none') {
            section.style.display = '';
            expandBtn.innerHTML = '&#9660;';
            await app.loadUnassignedBills();
        } else {
            section.style.display = 'none';
            expandBtn.innerHTML = '&#9654;';
        }
    };

    app.loadProviderDetails = async function (providerId) {
        const section = document.getElementById(`provider-details-${providerId}`);
        if (!section) return;

        const [billsRes, paymentsRes] = await Promise.all([
            fetch(`${app.API}/bills?personId=${state.selectedPersonId}&providerId=${providerId}`),
            fetch(`${app.API}/providers/${providerId}/payments`)
        ]);

        let bills = [];
        let payments = [];
        if (billsRes.ok) bills = await billsRes.json();
        if (paymentsRes.ok) payments = await paymentsRes.json();

        const categoryOptions = `
            <option value="">Category</option>
            <option value="office_visit">Office Visit</option>
            <option value="lab">Lab</option>
            <option value="pharmacy">Pharmacy</option>
            <option value="imaging">Imaging</option>
            <option value="surgery">Surgery</option>
            <option value="therapy">Therapy</option>
            <option value="emergency">Emergency</option>
            <option value="dental">Dental</option>
            <option value="vision">Vision</option>
            <option value="other">Other</option>`;

        const docOptions = state.currentDocuments.map(d => {
            const label = d.title || d.fileName || `Document #${d.id}`;
            return `<option value="${d.id}">${app.escapeHtml(label)}</option>`;
        }).join('');

        const billsHtml = bills.map(b => {
            const meta = [];
            if (b.billDate) meta.push(app.formatDate(b.billDate));
            if (b.category) meta.push(app.formatLabel(b.category));
            if (b.doctorName) meta.push('Dr. ' + b.doctorName);

            const docNames = b.documentNames ? `<div class="bill-meta">Docs: ${app.escapeHtml(b.documentNames)}</div>` : '';

            return `<div class="charge-item" style="flex-direction:column;align-items:stretch;gap:4px;" id="bill-${b.id}">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;" onclick="medDocsToggleBillCharges(${b.id})">
                        <span class="expand-btn" id="bill-expand-${b.id}" style="font-size:10px;">&#9654;</span>
                        <span class="charge-desc">${app.escapeHtml(b.summary || 'Bill')}</span>
                        <span class="charge-amount">${app.formatCurrency(b.totalAmount)}</span>
                    </div>
                    <button class="delete-btn btn-sm" onclick="medDocsDeleteBill(${b.id}, ${providerId})">Delete</button>
                </div>
                <div class="prescription-meta" style="margin-left:18px;">${meta.map(m => app.escapeHtml(m)).join(' &middot; ')}</div>
                ${docNames ? `<div style="margin-left:18px;">${docNames}</div>` : ''}
                <div id="bill-charges-${b.id}" style="display:none;margin-left:18px;margin-top:4px;">
                    <div class="charges-header">Charges</div>
                    <div class="pickup-form">
                        <div class="inline-form-row">
                            <input type="text" id="chargeDesc-${b.id}" placeholder="Description *" class="form-input" />
                            <input type="number" id="chargeAmount-${b.id}" placeholder="Amount *" class="form-input" step="0.01" min="0.01" />
                            <button class="btn btn-primary btn-sm" onclick="medDocsAddCharge(${b.id}, ${providerId})">Add</button>
                        </div>
                    </div>
                    <div class="charge-list" id="chargeList-${b.id}"></div>
                    <div class="section-divider"></div>
                    <div class="pickup-form">
                        <div class="inline-form-row">
                            <select id="linkDoc-${b.id}" class="form-input">
                                <option value="">Link document...</option>
                                ${docOptions}
                            </select>
                            <button class="btn btn-secondary btn-sm" onclick="medDocsLinkDocument(${b.id}, ${providerId})">Link Doc</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');

        const paymentsHtml = payments.map(p => {
            const meta = [];
            if (p.paymentDate) meta.push(app.formatDate(p.paymentDate));
            if (p.description) meta.push(p.description);
            return `<div class="pickup-item">
                <div class="pickup-info">
                    <span class="pickup-date">${app.formatCurrency(p.amount)}</span>
                    ${meta.length ? `<span class="pickup-meta">${meta.map(m => app.escapeHtml(m)).join(' &middot; ')}</span>` : ''}
                </div>
                <button class="delete-btn btn-sm" onclick="medDocsDeleteProviderPayment(${p.id}, ${providerId})">Delete</button>
            </div>`;
        }).join('');

        section.innerHTML = `
            <div class="charges-section">
                <div class="charges-header">Bills</div>
                <div class="pickup-form">
                    <div class="inline-form-row">
                        <input type="number" id="newBillAmount-${providerId}" placeholder="Amount *" class="form-input" step="0.01" min="0.01" />
                        <input type="text" id="newBillSummary-${providerId}" placeholder="Summary" class="form-input" />
                        <select id="newBillCategory-${providerId}" class="form-input">${categoryOptions}</select>
                        <input type="date" id="newBillDate-${providerId}" class="form-input" title="Bill date" />
                        <button class="btn btn-primary btn-sm" onclick="medDocsAddBill(${providerId})">Add Bill</button>
                    </div>
                </div>
                <div class="bills-in-provider">${billsHtml || '<div class="empty-state" style="padding:8px;font-size:12px">No bills.</div>'}</div>
            </div>
            <div class="section-divider"></div>
            <div class="payments-section">
                <div class="charges-header">Payments</div>
                <div class="pickup-form">
                    <div class="inline-form-row">
                        <input type="number" id="provPayAmount-${providerId}" placeholder="Amount *" class="form-input" step="0.01" min="0.01" />
                        <input type="date" id="provPayDate-${providerId}" class="form-input" title="Payment date" />
                        <input type="text" id="provPayDesc-${providerId}" placeholder="Description" class="form-input" />
                        <button class="btn btn-primary btn-sm" onclick="medDocsAddProviderPayment(${providerId})">Add Payment</button>
                    </div>
                </div>
                <div class="payment-list">${paymentsHtml || '<div class="empty-state" style="padding:8px;font-size:12px">No payments recorded.</div>'}</div>
            </div>`;
    };

    app.loadUnassignedBills = async function () {
        const section = document.getElementById('provider-details-unassigned');
        if (!section) return;

        const res = await fetch(`${app.API}/bills?personId=${state.selectedPersonId}`);
        if (!res.ok) return;
        const allBills = await res.json();
        const bills = allBills.filter(b => !b.providerId);

        const providerOptions = state.currentProviders.map(p =>
            `<option value="${p.id}">${app.escapeHtml(p.name)}</option>`
        ).join('');

        const billsHtml = bills.map(b => {
            const meta = [];
            if (b.billDate) meta.push(app.formatDate(b.billDate));
            if (b.category) meta.push(app.formatLabel(b.category));

            return `<div class="charge-item" style="flex-direction:column;align-items:stretch;gap:4px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <span class="charge-desc">${app.escapeHtml(b.summary || 'Bill')}</span>
                        <span class="charge-amount">${app.formatCurrency(b.totalAmount)}</span>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <select id="assignProvider-${b.id}" class="form-input" style="min-width:120px;">
                            <option value="">Assign to provider...</option>
                            ${providerOptions}
                        </select>
                        <button class="btn btn-secondary btn-sm" onclick="medDocsAssignBillToProvider(${b.id})">Assign</button>
                        <button class="delete-btn btn-sm" onclick="medDocsDeleteBill(${b.id}, 0)">Delete</button>
                    </div>
                </div>
                <div class="prescription-meta">${meta.map(m => app.escapeHtml(m)).join(' &middot; ')}</div>
            </div>`;
        }).join('');

        section.innerHTML = `<div class="bills-in-provider">${billsHtml}</div>`;
    };

    // --- Actions ---

    app.addProvider = async function () {
        const name = document.getElementById('newProviderName').value.trim();
        if (!name) { alert('Provider name is required'); return; }

        const res = await fetch(`${app.API}/providers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: state.selectedPersonId,
                name,
                notes: document.getElementById('newProviderNotes').value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add provider');
            return;
        }

        document.getElementById('newProviderName').value = '';
        document.getElementById('newProviderNotes').value = '';
        await app.loadBills();
    };

    app.deleteProvider = async function (id) {
        if (!confirm('Delete this provider and unlink all its bills?')) return;
        const res = await fetch(`${app.API}/providers/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadBills();
    };

    app.addBill = async function (providerId) {
        const amountStr = document.getElementById(`newBillAmount-${providerId}`).value;
        if (!amountStr || parseFloat(amountStr) <= 0) { alert('Amount must be greater than 0'); return; }

        const res = await fetch(`${app.API}/bills`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personId: state.selectedPersonId,
                totalAmount: parseFloat(amountStr),
                summary: document.getElementById(`newBillSummary-${providerId}`).value.trim() || null,
                category: document.getElementById(`newBillCategory-${providerId}`).value || null,
                billDate: document.getElementById(`newBillDate-${providerId}`).value || null,
                providerId
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add bill');
            return;
        }

        document.getElementById(`newBillAmount-${providerId}`).value = '';
        document.getElementById(`newBillSummary-${providerId}`).value = '';
        document.getElementById(`newBillCategory-${providerId}`).value = '';
        document.getElementById(`newBillDate-${providerId}`).value = '';
        await app.refreshProvider(providerId);
    };

    app.deleteBill = async function (id, providerId) {
        if (!confirm('Delete this bill and all its charges?')) return;
        const res = await fetch(`${app.API}/bills/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        if (providerId) {
            await app.refreshProvider(providerId);
        } else {
            await app.loadBills();
        }
    };

    app.addProviderPayment = async function (providerId) {
        const amountStr = document.getElementById(`provPayAmount-${providerId}`).value;
        if (!amountStr || parseFloat(amountStr) <= 0) { alert('Amount must be greater than 0'); return; }

        const res = await fetch(`${app.API}/providers/${providerId}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: parseFloat(amountStr),
                paymentDate: document.getElementById(`provPayDate-${providerId}`).value || null,
                description: document.getElementById(`provPayDesc-${providerId}`).value.trim() || null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add payment');
            return;
        }

        document.getElementById(`provPayAmount-${providerId}`).value = '';
        document.getElementById(`provPayDate-${providerId}`).value = '';
        document.getElementById(`provPayDesc-${providerId}`).value = '';
        await app.refreshProvider(providerId);
    };

    app.deleteProviderPayment = async function (id, providerId) {
        if (!confirm('Delete this payment?')) return;
        const res = await fetch(`${app.API}/provider-payments/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.refreshProvider(providerId);
    };

    app.toggleBillCharges = async function (billId) {
        const section = document.getElementById(`bill-charges-${billId}`);
        const expandBtn = document.getElementById(`bill-expand-${billId}`);
        if (section.style.display === 'none') {
            section.style.display = '';
            expandBtn.innerHTML = '&#9660;';
            await app.loadCharges(billId);
        } else {
            section.style.display = 'none';
            expandBtn.innerHTML = '&#9654;';
        }
    };

    app.loadCharges = async function (billId) {
        const res = await fetch(`${app.API}/bills/${billId}/charges`);
        if (!res.ok) return;
        const charges = await res.json();
        const container = document.getElementById(`chargeList-${billId}`);
        if (charges.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:8px;font-size:12px">No line items.</div>';
            return;
        }
        container.innerHTML = charges.map(c =>
            `<div class="charge-item">
                <div class="charge-info">
                    <span class="charge-desc">${app.escapeHtml(c.description)}</span>
                    <span class="charge-amount">${app.formatCurrency(c.amount)}</span>
                </div>
                <button class="delete-btn btn-sm" onclick="medDocsDeleteCharge(${c.id}, ${billId})">Delete</button>
            </div>`
        ).join('');
    };

    app.addCharge = async function (billId, providerId) {
        const desc = document.getElementById(`chargeDesc-${billId}`).value.trim();
        const amountStr = document.getElementById(`chargeAmount-${billId}`).value;
        if (!desc) { alert('Description is required'); return; }
        if (!amountStr || parseFloat(amountStr) <= 0) { alert('Amount must be greater than 0'); return; }

        const res = await fetch(`${app.API}/bills/${billId}/charges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: desc, amount: parseFloat(amountStr) })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to add charge');
            return;
        }

        document.getElementById(`chargeDesc-${billId}`).value = '';
        document.getElementById(`chargeAmount-${billId}`).value = '';
        await app.loadCharges(billId);
    };

    app.deleteCharge = async function (id, billId) {
        if (!confirm('Delete this charge?')) return;
        const res = await fetch(`${app.API}/bill-charges/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to delete');
            return;
        }
        await app.loadCharges(billId);
    };

    app.linkDocumentToBill = async function (billId, providerId) {
        const select = document.getElementById(`linkDoc-${billId}`);
        const docId = select.value;
        if (!docId) { alert('Select a document to link'); return; }

        const res = await fetch(`${app.API}/bills/${billId}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: parseInt(docId) })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to link document');
            return;
        }

        select.value = '';
        await app.refreshProvider(providerId);
    };

    app.assignBillToProvider = async function (billId) {
        const select = document.getElementById(`assignProvider-${billId}`);
        const providerId = select.value;
        if (!providerId) { alert('Select a provider'); return; }

        // Get current bill details first
        const getRes = await fetch(`${app.API}/bills?personId=${state.selectedPersonId}`);
        if (!getRes.ok) return;
        const allBills = await getRes.json();
        const bill = allBills.find(b => b.id === billId);
        if (!bill) return;

        const res = await fetch(`${app.API}/bills/${billId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                totalAmount: bill.totalAmount,
                summary: bill.summary,
                category: bill.category,
                billDate: bill.billDate,
                doctorId: bill.doctorId,
                providerId: parseInt(providerId)
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to assign bill');
            return;
        }

        await app.loadBills();
    };

    app.refreshProvider = async function (providerId) {
        // Refresh the summary and provider header, then reload details
        const [providersRes, summaryRes] = await Promise.all([
            fetch(`${app.API}/providers?personId=${state.selectedPersonId}`),
            fetch(`${app.API}/bills/summary?personId=${state.selectedPersonId}`)
        ]);

        if (providersRes.ok) {
            state.currentProviders = await providersRes.json();
        }

        if (summaryRes.ok) {
            const summary = await summaryRes.json();
            app.loadBillSummary(summary);
        }

        // Update the provider header info
        const provider = state.currentProviders.find(p => p.id === providerId);
        if (provider) {
            const headerInfo = document.querySelector(`#provider-${providerId} .prescription-meta`);
            if (headerInfo) {
                headerInfo.textContent = '';
                headerInfo.innerHTML = `${app.formatCurrency(provider.totalCharged)} charged &middot; ${app.formatCurrency(provider.totalPaid)} paid &middot; ${app.formatCurrency(provider.balance)} balance &middot; ${provider.billCount} bill${provider.billCount !== 1 ? 's' : ''}`;
            }

            const statusBadge = document.querySelector(`#provider-${providerId} .bill-status`);
            if (statusBadge) {
                const statusClass = provider.balance <= 0 ? 'paid' : provider.totalPaid > 0 ? 'partial' : 'unpaid';
                const statusLabel = provider.balance <= 0 ? 'Paid' : provider.totalPaid > 0 ? 'Partial' : 'Unpaid';
                statusBadge.className = `bill-status ${statusClass}`;
                statusBadge.textContent = statusLabel;
            }
        }

        // Reload provider details if expanded
        const section = document.getElementById(`provider-details-${providerId}`);
        if (section && section.style.display !== 'none') {
            await app.loadProviderDetails(providerId);
        }
    };

    // --- Window bindings ---
    window.medDocsAddProvider = () => app.addProvider();
    window.medDocsDeleteProvider = (id) => app.deleteProvider(id);
    window.medDocsToggleProvider = (id) => app.toggleProvider(id);
    window.medDocsToggleUnassigned = () => app.toggleUnassigned();
    window.medDocsAddBill = (providerId) => app.addBill(providerId);
    window.medDocsDeleteBill = (id, providerId) => app.deleteBill(id, providerId);
    window.medDocsToggleBillCharges = (billId) => app.toggleBillCharges(billId);
    window.medDocsAddCharge = (billId, providerId) => app.addCharge(billId, providerId);
    window.medDocsDeleteCharge = (id, billId) => app.deleteCharge(id, billId);
    window.medDocsAddProviderPayment = (providerId) => app.addProviderPayment(providerId);
    window.medDocsDeleteProviderPayment = (id, providerId) => app.deleteProviderPayment(id, providerId);
    window.medDocsLinkDocument = (billId, providerId) => app.linkDocumentToBill(billId, providerId);
    window.medDocsAssignBillToProvider = (billId) => app.assignBillToProvider(billId);
})(MedDocs);
