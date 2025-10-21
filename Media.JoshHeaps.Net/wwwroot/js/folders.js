// Folder management functionality
document.addEventListener('DOMContentLoaded', function() {
    const newFolderBtn = document.getElementById('new-folder-btn');

    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', showCreateFolderModal);
    }
});

function showCreateFolderModal() {
    const folderName = prompt('Enter folder name:');
    if (folderName && folderName.trim()) {
        createFolder(folderName.trim());
    }
}

async function createFolder(name) {
    try {
        const response = await fetch('/api/folder/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                parentFolderId: currentFolderId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            alert('Failed to create folder: ' + (error.error || 'Unknown error'));
            return;
        }

        // Reload page to show new folder
        window.location.reload();
    } catch (error) {
        console.error('Error creating folder:', error);
        alert('Failed to create folder');
    }
}

async function renameFolder(folderId, currentName) {
    const newName = prompt('Enter new name for folder:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) {
        return;
    }

    try {
        const response = await fetch('/api/folder/rename', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folderId: folderId,
                newName: newName.trim()
            })
        });

        if (!response.ok) {
            const error = await response.json();
            alert('Failed to rename folder: ' + (error.error || 'Unknown error'));
            return;
        }

        // Reload page to show updated name
        window.location.reload();
    } catch (error) {
        console.error('Error renaming folder:', error);
        alert('Failed to rename folder');
    }
}

async function deleteFolder(folderId) {
    if (!confirm('Are you sure you want to delete this folder? Its contents will be moved to the parent folder.')) {
        return;
    }

    try {
        const response = await fetch(`/api/folder/delete?folderId=${folderId}&deleteContents=true`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            alert('Failed to delete folder: ' + (error.error || 'Unknown error'));
            return;
        }

        // Reload page to reflect deletion
        window.location.reload();
    } catch (error) {
        console.error('Error deleting folder:', error);
        alert('Failed to delete folder');
    }
}

async function moveMedia(mediaId, targetFolderId) {
    try {
        const response = await fetch('/api/media/move', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mediaId: mediaId,
                folderId: targetFolderId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            alert('Failed to move media: ' + (error.error || 'Unknown error'));
            return;
        }

        // Remove item from gallery or reload page
        const mediaElement = document.querySelector(`[data-media-id="${mediaId}"]`);
        if (mediaElement) {
            mediaElement.remove();
        }
    } catch (error) {
        console.error('Error moving media:', error);
        alert('Failed to move media');
    }
}

async function moveFolder(folderId, targetParentFolderId) {
    try {
        const response = await fetch('/api/folder/move', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folderId: folderId,
                newParentFolderId: targetParentFolderId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            alert('Failed to move folder: ' + (error.error || 'Unknown error'));
            return;
        }

        // Reload page to reflect move
        window.location.reload();
    } catch (error) {
        console.error('Error moving folder:', error);
        alert('Failed to move folder');
    }
}
