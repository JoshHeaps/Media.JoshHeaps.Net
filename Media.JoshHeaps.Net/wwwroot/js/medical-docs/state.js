window.MedDocs = {
    API: '/api/medical-docs',

    state: {
        people: [],
        doctors: [],
        currentDocuments: [],
        currentPrescriptions: [],
        selectedPersonId: null,
        activeTab: 'doctors',
        searchDebounceTimer: null,
        currentProviders: []
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    escapeAttr(str) {
        return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
    },

    formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString();
    },

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    formatCurrency(amount) {
        return '$' + parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    formatLabel(str) {
        return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    },

    formatClassification(c) {
        return c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    },

    truncate(str, max) {
        return str.length > max ? str.substring(0, max) + '...' : str;
    },

    getDocIcon(doc) {
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
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
    },

    getAiStatusBadge(doc) {
        if (doc.aiProcessed) {
            return '<span class="ai-badge ai-done" title="AI processed">AI</span>';
        }
        return '<span class="ai-badge ai-pending" title="Not yet processed">No AI</span>';
    },

    updateSummaryCount(id, count) {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    }
};
