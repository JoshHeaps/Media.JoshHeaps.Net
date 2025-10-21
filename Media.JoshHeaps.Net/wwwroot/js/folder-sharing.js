// Folder sharing functionality
let currentShareFolderId = null;
let searchTimeout = null;

function showShareModal(folderId, folderName) {
    currentShareFolderId = folderId;
    const modal = document.getElementById('share-modal');
    const folderNameSpan = document.getElementById('share-folder-name');
    const userSearch = document.getElementById('user-search');

    folderNameSpan.textContent = folderName;
    userSearch.value = '';
    modal.style.display = 'block';

    // Load existing shares
    loadSharedUsers(folderId);

    // Clear search results
    document.getElementById('user-search-results').innerHTML = '';
}

function closeShareModal() {
    const modal = document.getElementById('share-modal');
    modal.style.display = 'none';
    currentShareFolderId = null;
}

async function loadSharedUsers(folderId) {
    const list = document.getElementById('shared-users-list');
    list.innerHTML = '<p class="text-muted">Loading...</p>';

    try {
        const response = await fetch(`/api/folder-share/list-shares?folderId=${folderId}`);
        if (!response.ok) {
            throw new Error('Failed to load shares');
        }

        const shares = await response.json();

        if (shares.length === 0) {
            list.innerHTML = '<p class="text-muted">Not shared with anyone yet</p>';
            return;
        }

        list.innerHTML = '';
        shares.forEach(share => {
            const userItem = document.createElement('div');
            userItem.className = 'shared-user-item';
            userItem.innerHTML = `
                <div class="user-info">
                    <strong>${share.sharedWithUsername}</strong>
                    <span class="user-email">${share.sharedWithEmail}</span>
                </div>
                <button type="button" class="btn-remove" onclick="removeShare(${folderId}, ${share.sharedWithUserId}, '${share.sharedWithUsername}')">
                    Remove
                </button>
            `;
            list.appendChild(userItem);
        });
    } catch (error) {
        console.error('Error loading shares:', error);
        list.innerHTML = '<p class="text-error">Failed to load shares</p>';
    }
}

async function removeShare(folderId, sharedWithUserId, username) {
    if (!confirm(`Remove access for ${username}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/folder-share/unshare?folderId=${folderId}&sharedWithUserId=${sharedWithUserId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to remove share');
        }

        // Reload the shared users list
        loadSharedUsers(folderId);
    } catch (error) {
        console.error('Error removing share:', error);
        alert('Failed to remove access');
    }
}

// User search with debouncing
document.addEventListener('DOMContentLoaded', function() {
    const userSearch = document.getElementById('user-search');
    if (!userSearch) return;

    userSearch.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        const query = this.value.trim();

        if (query.length < 2) {
            document.getElementById('user-search-results').innerHTML = '';
            return;
        }

        searchTimeout = setTimeout(() => searchUsers(query), 300);
    });
});

async function searchUsers(query) {
    const resultsDiv = document.getElementById('user-search-results');
    resultsDiv.innerHTML = '<p class="text-muted">Searching...</p>';

    try {
        const response = await fetch(`/api/folder-share/search-users?query=${encodeURIComponent(query)}`);
        if (!response.ok) {
            throw new Error('Search failed');
        }

        const users = await response.json();

        if (users.length === 0) {
            resultsDiv.innerHTML = '<p class="text-muted">No users found</p>';
            return;
        }

        resultsDiv.innerHTML = '';
        users.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = 'search-result-item';
            userItem.innerHTML = `
                <div class="user-info">
                    <strong>${user.username}</strong>
                    <span class="user-email">${user.email}</span>
                </div>
                <button type="button" class="btn-add" onclick="shareWithUser(${currentShareFolderId}, ${user.id}, '${user.username}')">
                    Share
                </button>
            `;
            resultsDiv.appendChild(userItem);
        });
    } catch (error) {
        console.error('Error searching users:', error);
        resultsDiv.innerHTML = '<p class="text-error">Search failed</p>';
    }
}

async function shareWithUser(folderId, userId, username) {
    try {
        const response = await fetch('/api/folder-share/share', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folderId: folderId,
                sharedWithUserId: userId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to share');
        }

        // Clear search
        document.getElementById('user-search').value = '';
        document.getElementById('user-search-results').innerHTML = '';

        // Reload shared users list
        loadSharedUsers(folderId);

        alert(`Folder shared with ${username}`);
    } catch (error) {
        console.error('Error sharing folder:', error);
        alert('Failed to share folder: ' + error.message);
    }
}

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeShareModal();
    }
});
