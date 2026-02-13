(function (app) {
    document.addEventListener('DOMContentLoaded', async function () {
        await app.loadPeople();

        // Add person
        document.getElementById('addPersonBtn').addEventListener('click', () => app.addPerson());
        document.getElementById('newPersonName').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') app.addPerson();
        });

        // Upload sub-tabs (file vs note)
        document.querySelectorAll('.upload-sub-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => app.switchUploadTab(btn.dataset.tab));
        });

        // File upload
        document.getElementById('browseBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        document.getElementById('fileInput').addEventListener('change', app.handleFileSelect);

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
                app.uploadFiles(e.dataTransfer.files);
            }
        });

        // Save note
        document.getElementById('saveNoteBtn').addEventListener('click', () => app.saveNote());

        // Filter bar event listeners
        document.getElementById('filterSearch').addEventListener('input', () => {
            clearTimeout(app.state.searchDebounceTimer);
            app.state.searchDebounceTimer = setTimeout(() => app.loadDocuments(), 300);
        });
        ['filterClassification', 'filterDocType', 'filterDoctor', 'filterTag', 'filterCondition', 'filterFromDate', 'filterToDate'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => app.loadDocuments());
        });

        // Default: load all-persons view
        app.selectAll();
    });
})(MedDocs);
