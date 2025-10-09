// Handle multiple file uploads sequentially
document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('UploadedFile');
    const descriptionInput = document.getElementById('Description');
    const uploadBtn = document.getElementById('upload-btn');
    const progressContainer = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const galleryElement = document.getElementById('gallery');

    if (!uploadForm) return;

    uploadForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const files = fileInput.files;
        if (!files || files.length === 0) {
            alert('Please select at least one file');
            return;
        }

        // Validate file sizes
        const maxSize = 10 * 1024 * 1024; // 10MB
        for (let file of files) {
            if (file.size > maxSize) {
                alert(`File "${file.name}" exceeds 10MB limit`);
                return;
            }
        }

        // Disable form during upload
        uploadBtn.disabled = true;
        fileInput.disabled = true;
        descriptionInput.disabled = true;
        progressContainer.style.display = 'block';

        const description = descriptionInput.value;
        let successCount = 0;
        let failCount = 0;

        // Upload files sequentially
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const progress = Math.round(((i + 1) / files.length) * 100);

            progressFill.style.width = `${progress}%`;
            progressText.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name}`;

            try {
                const success = await uploadSingleFile(file, description);
                if (success) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`Failed to upload ${file.name}:`, error);
                failCount++;
            }
        }

        // Reset form
        uploadBtn.disabled = false;
        fileInput.disabled = false;
        descriptionInput.disabled = false;
        progressContainer.style.display = 'none';
        progressFill.style.width = '0%';

        // Show results
        if (successCount > 0 && failCount === 0) { }
        else if (successCount > 0 && failCount > 0) {
            alert(`Uploaded ${successCount} image(s), but ${failCount} failed.`);
        } else {
            alert(`Failed to upload all ${failCount} image(s).`);
        }

        // Reset form and reload page
        uploadForm.reset();
        window.location.reload();
    });

    async function uploadSingleFile(file, description) {
        const formData = new FormData();
        formData.append('UploadedFile', file);
        if (description) {
            formData.append('Description', description);
        }

        // Get anti-forgery token
        const token = document.querySelector('input[name="__RequestVerificationToken"]').value;
        formData.append('__RequestVerificationToken', token);

        try {
            const response = await fetch('/?handler=Add', {
                method: 'POST',
                body: formData
            });

            return response.ok;
        } catch (error) {
            console.error('Upload error:', error);
            return false;
        }
    }
});
