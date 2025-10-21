// Global state for selection
let selectedMediaIds = new Set();

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Restore selection from sessionStorage
    const savedSelection = sessionStorage.getItem('selectedMediaIds');
    if (savedSelection) {
        try {
            const savedIds = JSON.parse(savedSelection);
            savedIds.forEach(id => {
                selectedMediaIds.add(id);
                const checkbox = document.querySelector(`.media-select[data-media-id="${id}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                    checkbox.closest('.gallery-item').classList.add('selected');
                }
            });
        } catch (e) {
            console.error('Failed to restore selection:', e);
            sessionStorage.removeItem('selectedMediaIds');
        }
    }

    // Upload form toggle functionality
    const addFilesBtn = document.getElementById('add-files-btn');
    const uploadFormCard = document.getElementById('upload-form-card');
    const closeUploadBtn = document.getElementById('close-upload-btn');

    if (addFilesBtn && uploadFormCard) {
        addFilesBtn.addEventListener('click', () => {
            if (addFilesBtn.classList.contains('active')) {
                uploadFormCard.style.display = 'none';
                addFilesBtn.classList.remove('active');
            }
            else {
                uploadFormCard.style.display = 'block';
                addFilesBtn.classList.add('active');
            }
        });

        if (closeUploadBtn) {
            closeUploadBtn.addEventListener('click', () => {
                uploadFormCard.style.display = 'none';
                addFilesBtn.classList.remove('active');
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && uploadFormCard.style.display === 'block') {
                uploadFormCard.style.display = 'none';
                addFilesBtn.classList.remove('active');
            }
        });

        // Close when clicking outside the form
        document.addEventListener('click', (e) => {
            if (uploadFormCard.style.display === 'block' &&
                !uploadFormCard.contains(e.target) &&
                !addFilesBtn.contains(e.target)) {
                uploadFormCard.style.display = 'none';
                addFilesBtn.classList.remove('active');
            }
        });
    }

    // Lazy loading for gallery images using Intersection Observer
    let currentOffset = 20; // Initial load was 20 items
    let isLoading = false;
    let hasMore = true;

    // Create intersection observer for lazy loading
    const loadingElement = document.getElementById('loading');
    const galleryElement = document.getElementById('gallery');

    if (loadingElement && galleryElement) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !isLoading && hasMore) {
                    loadMoreImages();
                }
            });
        }, {
            rootMargin: '200px' // Start loading 200px before the element comes into view
        });

        observer.observe(loadingElement);
    }

    async function loadMoreImages() {
        if (isLoading || !hasMore) return;

        isLoading = true;
        loadingElement.style.display = 'block';

        try {
            const folderParam = currentFolderId ? `&folderId=${currentFolderId}` : '';
            const response = await fetch(`/api/media/load?offset=${currentOffset}&limit=20${folderParam}`);

            if (!response.ok) {
                throw new Error('Failed to load images');
            }

            const mediaItems = await response.json();

            if (mediaItems.length === 0) {
                hasMore = false;
                loadingElement.style.display = 'none';
                return;
            }

            // Add new images to gallery
            mediaItems.forEach(media => {
                const galleryItem = createGalleryItem(media);
                galleryElement.appendChild(galleryItem);
            });

            currentOffset += mediaItems.length;
        } catch (error) {
            console.error('Error loading images:', error);
            loadingElement.innerHTML = 'Failed to load more images.';
        } finally {
            isLoading = false;
            if (hasMore) {
                loadingElement.style.display = 'none';
            }
        }
    }

    function createGalleryItem(media) {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.setAttribute('data-media-id', media.id);

        const img = document.createElement('img');
        img.src = `/api/media/image/${media.id}`;
        img.alt = media.fileName;
        img.loading = 'lazy';
        item.appendChild(img);

        if (media.description) {
            const desc = document.createElement('div');
            desc.className = 'gallery-item-description';
            desc.textContent = media.description;
            item.appendChild(desc);
        }

        const info = document.createElement('div');
        info.className = 'gallery-item-info';

        const date = document.createElement('span');
        date.className = 'gallery-item-date';
        const createdDate = new Date(media.createdAt);
        date.textContent = createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        info.appendChild(date);

        const form = document.createElement('form');
        form.method = 'post';
        form.action = '?handler=Delete'; // Relative to current page
        form.style.display = 'inline';

        // Add anti-forgery token
        const tokenInput = document.querySelector('input[name="__RequestVerificationToken"]');
        if (tokenInput) {
            const tokenClone = tokenInput.cloneNode(true);
            form.appendChild(tokenClone);
        }

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'MediaId'; // Match C# property name exactly
        hiddenInput.value = media.id;
        form.appendChild(hiddenInput);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'submit';
        deleteBtn.className = 'btn-delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = function(e) {
            if (!confirm('Are you sure you want to delete this image?')) {
                e.preventDefault();
                return false;
            }
        };
        form.appendChild(deleteBtn);

        info.appendChild(form);
        item.appendChild(info);

        return item;
    }

    // Optional: Add image preview on click
    galleryElement?.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            const modal = createImageModal(e.target.src);
            document.body.appendChild(modal);
        }
    });

    function createImageModal(imageSrc) {
        const modal = document.createElement('div');
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content">
                <img src="${imageSrc}" alt="Full size image" />
                <button class="modal-close">&times;</button>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-backdrop') ||
                e.target.classList.contains('modal-close') ||
                e.target.classList.contains('image-modal')) {
                modal.remove();
            }
        });

        return modal;
    }

    // Selection functionality
    const selectionBar = document.getElementById('selection-bar');
    const selectionCount = document.getElementById('selection-count');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const moveHereBtn = document.getElementById('move-here-btn');
    const cancelSelectionBtn = document.getElementById('cancel-selection-btn');

    // Initialize selection UI after elements are available
    if (selectedMediaIds.size > 0) {
        updateSelectionUI();
    }

    // Delegate event listener for checkboxes
    if (galleryElement) {
        galleryElement.addEventListener('change', function(e) {
            if (e.target.classList.contains('media-select')) {
                const mediaId = parseInt(e.target.dataset.mediaId);
                if (e.target.checked) {
                    selectedMediaIds.add(mediaId);
                    e.target.closest('.gallery-item').classList.add('selected');
                } else {
                    selectedMediaIds.delete(mediaId);
                    e.target.closest('.gallery-item').classList.remove('selected');
                }
                updateSelectionUI();
            }
        });

        // Click on image to toggle selection
        galleryElement.addEventListener('click', function(e) {
            if (e.target.tagName === 'IMG' && !e.target.closest('.folder-item')) {
                const galleryItem = e.target.closest('.gallery-item');
                if (galleryItem) {
                    const checkbox = galleryItem.querySelector('.media-select');
                    if (checkbox && selectedMediaIds.size > 0) {
                        // If we're in selection mode, toggle checkbox
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                        e.stopPropagation();
                        return;
                    }
                }
            }
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function() {
            const checkboxes = document.querySelectorAll('.media-select');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                const mediaId = parseInt(checkbox.dataset.mediaId);
                selectedMediaIds.add(mediaId);
                checkbox.closest('.gallery-item').classList.add('selected');
            });
            updateSelectionUI();
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', function() {
            clearSelection();
        });
    }

    if (cancelSelectionBtn) {
        cancelSelectionBtn.addEventListener('click', function() {
            clearSelection();
        });
    }

    if (moveHereBtn) {
        moveHereBtn.addEventListener('click', async function() {
            if (selectedMediaIds.size === 0) return;

            const confirmed = confirm(`Move ${selectedMediaIds.size} image(s) to this folder?`);
            if (!confirmed) return;

            try {
                const response = await fetch('/api/media/move-bulk', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        mediaIds: Array.from(selectedMediaIds),
                        folderId: currentFolderId
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
                    selectedMediaIds.forEach(mediaId => {
                        const item = document.querySelector(`[data-media-id="${mediaId}"]`);
                        if (item) item.remove();
                    });
                    // Clear selection and sessionStorage
                    sessionStorage.removeItem('selectedMediaIds');
                    clearSelection();

                    if (result.failedCount > 0) {
                        alert(`Moved ${result.movedCount} image(s). ${result.failedCount} failed.`);
                    }
                }
            } catch (error) {
                console.error('Error moving media:', error);
                alert('Failed to move media');
            }
        });
    }

    function updateSelectionUI() {
        const count = selectedMediaIds.size;
        if (count > 0) {
            selectionBar.style.display = 'flex';
            selectionCount.textContent = `${count} image${count > 1 ? 's' : ''} selected`;
            // Save to sessionStorage
            sessionStorage.setItem('selectedMediaIds', JSON.stringify([...selectedMediaIds]));
        } else {
            selectionBar.style.display = 'none';
            // Clear from sessionStorage if empty
            sessionStorage.removeItem('selectedMediaIds');
        }
    }

    function clearSelection() {
        selectedMediaIds.clear();
        const checkboxes = document.querySelectorAll('.media-select');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            checkbox.closest('.gallery-item').classList.remove('selected');
        });
        sessionStorage.removeItem('selectedMediaIds');
        updateSelectionUI();
    }

    // Export for use in other scripts
    window.gallerySelection = {
        getSelectedIds: () => Array.from(selectedMediaIds),
        addSelection: (mediaId) => {
            selectedMediaIds.add(mediaId);
            const checkbox = document.querySelector(`.media-select[data-media-id="${mediaId}"]`);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.closest('.gallery-item').classList.add('selected');
            }
            updateSelectionUI();
        },
        clearSelection: clearSelection,
        updateUI: updateSelectionUI
    };
}); // End of DOMContentLoaded
