(function () {
    let posts = [];

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        await loadPosts();

        document.getElementById('newPostBtn').addEventListener('click', showNewPostEditor);
        document.getElementById('savePostBtn').addEventListener('click', savePost);
        document.getElementById('cancelEditBtn').addEventListener('click', hideEditor);
    }

    async function loadPosts() {
        const res = await fetch('/api/blog/posts');
        if (!res.ok) return;
        posts = await res.json();
        renderPostsTable();
    }

    function renderPostsTable() {
        const tbody = document.getElementById('postsTableBody');
        if (posts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-message">No posts yet. Create your first post!</td></tr>';
            return;
        }
        tbody.innerHTML = posts.map(post => {
            const tags = post.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('');
            const date = new Date(post.publishedDate).toLocaleDateString();
            return `<tr>
                <td>${escapeHtml(post.title)}</td>
                <td><code>${escapeHtml(post.slug)}</code></td>
                <td><div class="tag-list">${tags}</div></td>
                <td>${date}</td>
                <td class="action-cell">
                    <button class="btn btn-secondary btn-sm" onclick="blogEditPost(${post.id})">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="blogDeletePost(${post.id})">Delete</button>
                </td>
            </tr>`;
        }).join('');
    }

    function showNewPostEditor() {
        document.getElementById('editorTitle').textContent = 'New Post';
        document.getElementById('editPostId').value = '';
        document.getElementById('postTitle').value = '';
        document.getElementById('postSummary').value = '';
        document.getElementById('postTags').value = '';
        document.getElementById('postContent').value = '';
        document.getElementById('postDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('postsList').style.display = 'none';
        document.getElementById('postEditor').style.display = '';
    }

    function hideEditor() {
        document.getElementById('postEditor').style.display = 'none';
        document.getElementById('postsList').style.display = '';
    }

    async function savePost() {
        const id = document.getElementById('editPostId').value;
        const title = document.getElementById('postTitle').value.trim();
        const summary = document.getElementById('postSummary').value.trim();
        const tagsStr = document.getElementById('postTags').value.trim();
        const markdownContent = document.getElementById('postContent').value;
        const dateStr = document.getElementById('postDate').value;

        if (!title) { alert('Title is required'); return; }
        if (!markdownContent) { alert('Content is required'); return; }

        const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
        const publishedDate = dateStr ? new Date(dateStr + 'T00:00:00Z').toISOString() : null;

        const body = { title, summary, markdownContent, tags, publishedDate };
        const url = id ? `/api/blog/posts/${id}` : '/api/blog/posts';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to save post');
            return;
        }

        hideEditor();
        await loadPosts();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    window.blogEditPost = async function (id) {
        const res = await fetch(`/api/blog/posts`);
        if (!res.ok) return;
        const allPosts = await res.json();

        // Need markdown content, so fetch the admin-specific data
        // The public API doesn't return markdownContent, so we fetch all and find by id
        // Actually, we need to get it from the create/update response pattern
        // For editing, we'll fetch via a dedicated admin endpoint or use stored data
        // Since the public GET returns htmlContent but not markdownContent,
        // let's make a specific request. But our API only has public routes returning htmlContent.
        // We need the admin to get markdownContent too.

        // Workaround: find in local posts array (which has htmlContent), but we need markdown.
        // The cleanest fix is to have the GET endpoints also return markdownContent for admins,
        // but for now let's add an admin-specific detail endpoint.
        // Actually, looking at the API, the GET /posts/{slug} returns the public DTO.
        // Let me use a different approach: store markdownContent in memory from the list.

        // For now, we need to get the post with markdownContent.
        // Let's fetch by id from the admin-aware endpoint.
        const detailRes = await fetch(`/api/blog/posts/admin/${id}`);
        if (!detailRes.ok) {
            alert('Failed to load post for editing');
            return;
        }
        const post = await detailRes.json();

        document.getElementById('editorTitle').textContent = 'Edit Post';
        document.getElementById('editPostId').value = post.id;
        document.getElementById('postTitle').value = post.title;
        document.getElementById('postSummary').value = post.summary || '';
        document.getElementById('postTags').value = (post.tags || []).join(', ');
        document.getElementById('postContent').value = post.markdownContent || '';
        document.getElementById('postDate').value = new Date(post.publishedDate).toISOString().split('T')[0];
        document.getElementById('postsList').style.display = 'none';
        document.getElementById('postEditor').style.display = '';
    };

    window.blogDeletePost = async function (id) {
        if (!confirm('Are you sure you want to delete this post?')) return;

        const res = await fetch(`/api/blog/posts/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to delete post');
            return;
        }
        await loadPosts();
    };
})();
