// Context menu functionality for media items
document.addEventListener('DOMContentLoaded', function() {
    let contextMenu = null;
    let currentMediaId = null;

    // Create context menu element
    function createContextMenu() {
        if (contextMenu) return contextMenu;

        contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu';
        contextMenu.innerHTML = `
            <div class="context-menu-item" data-action="move">Move to...</div>
            <div class="context-menu-item" data-action="delete">Delete</div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="select">Select</div>
        `;
        document.body.appendChild(contextMenu);

        // Handle menu item clicks
        contextMenu.addEventListener('click', function(e) {
            const menuItem = e.target.closest('.context-menu-item');
            if (!menuItem) return;

            const action = menuItem.dataset.action;
            handleContextAction(action);
            hideContextMenu();
        });

        return contextMenu;
    }

    // Show context menu
    function showContextMenu(x, y, mediaId) {
        createContextMenu();
        currentMediaId = mediaId;

        // Update select/deselect text
        const selectItem = contextMenu.querySelector('[data-action="select"]');
        if (selectItem && window.gallerySelection) {
            const isSelected = window.gallerySelection.getSelectedIds().includes(mediaId);
            selectItem.textContent = isSelected ? 'Deselect' : 'Select';
        }

        // Position menu
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.style.display = 'block';

        // Adjust if menu goes off screen
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
    }

    // Hide context menu
    function hideContextMenu() {
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
        currentMediaId = null;
    }

    // Handle context menu actions
    function handleContextAction(action) {
        if (!currentMediaId) return;

        switch (action) {
            case 'move':
                // Add to selection and enter move mode
                if (window.gallerySelection) {
                    // If not already selected, clear selection and select this one
                    if (!window.gallerySelection.getSelectedIds().includes(currentMediaId)) {
                        window.gallerySelection.clearSelection();
                        window.gallerySelection.addSelection(currentMediaId);
                    }
                    // Selection bar will show with "Move Here" button
                }
                break;

            case 'delete':
                deleteMedia(currentMediaId);
                break;

            case 'select':
                if (window.gallerySelection) {
                    const isSelected = window.gallerySelection.getSelectedIds().includes(currentMediaId);
                    if (isSelected) {
                        // Deselect
                        const checkbox = document.querySelector(`.media-select[data-media-id="${currentMediaId}"]`);
                        if (checkbox) {
                            checkbox.checked = false;
                            checkbox.dispatchEvent(new Event('change'));
                        }
                    } else {
                        // Select
                        window.gallerySelection.addSelection(currentMediaId);
                    }
                }
                break;
        }
    }

    // Delete media function
    async function deleteMedia(mediaId) {
        if (!confirm('Are you sure you want to delete this image?')) {
            return;
        }

        const mediaItem = document.querySelector(`.media-item[data-media-id="${mediaId}"]`);
        const deleteForm = mediaItem?.querySelector('form[action*="Delete"]');

        if (deleteForm) {
            // Use existing form submission
            deleteForm.submit();
        } else {
            // Fallback: remove from UI (would need delete API endpoint)
            console.warn('Delete form not found for media', mediaId);
        }
    }

    // Listen for right-click on media items
    document.addEventListener('contextmenu', function(e) {
        const mediaItem = e.target.closest('.media-item');
        if (!mediaItem) {
            hideContextMenu();
            return;
        }

        e.preventDefault();
        const mediaId = parseInt(mediaItem.dataset.mediaId);
        showContextMenu(e.pageX, e.pageY, mediaId);
    });

    // Hide context menu on click outside
    document.addEventListener('click', function(e) {
        if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // Hide context menu on scroll
    document.addEventListener('scroll', hideContextMenu);

    // Hide context menu on escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideContextMenu();
        }
    });
});
