// Drag and drop functionality for media items
document.addEventListener('DOMContentLoaded', function() {
    let draggedMediaIds = [];
    let dragCounter = 0;

    // Handle drag start on media items
    document.addEventListener('dragstart', function(e) {
        const mediaItem = e.target.closest('.media-item');
        if (!mediaItem) return;

        const mediaId = parseInt(mediaItem.dataset.mediaId);

        // If dragging a selected item, drag all selected items
        if (window.gallerySelection && window.gallerySelection.getSelectedIds().includes(mediaId)) {
            draggedMediaIds = window.gallerySelection.getSelectedIds();
        } else {
            draggedMediaIds = [mediaId];
        }

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedMediaIds.join(','));

        // Add visual feedback
        mediaItem.classList.add('dragging');
        if (draggedMediaIds.length > 1) {
            // Create drag preview showing count
            const dragPreview = document.createElement('div');
            dragPreview.className = 'drag-preview';
            dragPreview.textContent = `${draggedMediaIds.length} images`;
            dragPreview.style.position = 'absolute';
            dragPreview.style.top = '-1000px';
            document.body.appendChild(dragPreview);
            e.dataTransfer.setDragImage(dragPreview, 0, 0);
            setTimeout(() => dragPreview.remove(), 0);
        }
    });

    // Handle drag end
    document.addEventListener('dragend', function(e) {
        const mediaItem = e.target.closest('.media-item');
        if (mediaItem) {
            mediaItem.classList.remove('dragging');
        }

        // Remove all drop-target highlights
        document.querySelectorAll('.drop-target').forEach(el => {
            el.classList.remove('drop-target');
        });

        dragCounter = 0;
    });

    // Handle drag over folders
    document.addEventListener('dragover', function(e) {
        const folderItem = e.target.closest('.folder-item');
        if (!folderItem) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    // Handle drag enter on folders
    document.addEventListener('dragenter', function(e) {
        const folderItem = e.target.closest('.folder-item');
        if (!folderItem) return;

        dragCounter++;
        folderItem.classList.add('drop-target');
    });

    // Handle drag leave on folders
    document.addEventListener('dragleave', function(e) {
        const folderItem = e.target.closest('.folder-item');
        if (!folderItem) return;

        dragCounter--;
        if (dragCounter === 0) {
            folderItem.classList.remove('drop-target');
        }
    });

    // Handle drop on folders
    document.addEventListener('drop', async function(e) {
        const folderItem = e.target.closest('.folder-item');
        if (!folderItem) return;

        e.preventDefault();
        folderItem.classList.remove('drop-target');
        dragCounter = 0;

        const targetFolderId = folderItem.dataset.folderId === 'back'
            ? null
            : parseInt(folderItem.dataset.folderId);

        if (!draggedMediaIds || draggedMediaIds.length === 0) return;

        // Don't move if dropping on back button without a valid parent
        if (folderItem.dataset.folderId === 'back' && !targetFolderId && !currentFolderId) {
            return;
        }

        try {
            const response = await fetch('/api/media/move-bulk', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    mediaIds: draggedMediaIds,
                    folderId: targetFolderId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                alert('Failed to move media: ' + (error.error || 'Unknown error'));
                return;
            }

            const result = await response.json();
            if (result.movedCount > 0) {
                // Remove moved items from gallery
                draggedMediaIds.forEach(mediaId => {
                    const item = document.querySelector(`.media-item[data-media-id="${mediaId}"]`);
                    if (item) item.remove();
                });

                // Clear selection and sessionStorage if items were selected
                if (window.gallerySelection) {
                    sessionStorage.removeItem('selectedMediaIds');
                    window.gallerySelection.clearSelection();
                }

                if (result.failedCount > 0) {
                    alert(`Moved ${result.movedCount} image(s). ${result.failedCount} failed.`);
                }
            }
        } catch (error) {
            console.error('Error moving media:', error);
            alert('Failed to move media');
        } finally {
            draggedMediaIds = [];
        }
    });
});
