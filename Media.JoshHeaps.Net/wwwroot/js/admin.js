(function () {
    let allRoles = [];
    let currentPage = 1;
    const pageSize = 20;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        await loadRoles();
        await loadUsers(1);

        document.getElementById('createRoleBtn').addEventListener('click', createRole);
        document.getElementById('newRoleName').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createRole();
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.add-role-wrapper')) {
                document.querySelectorAll('.add-role-dropdown.open').forEach(d => d.classList.remove('open'));
            }
        });
    }

    async function loadRoles() {
        const res = await fetch('/api/admin/roles');
        if (!res.ok) return;
        allRoles = await res.json();
        renderRolesList();
    }

    function renderRolesList() {
        const container = document.getElementById('rolesList');
        container.innerHTML = allRoles.map(r =>
            `<span class="role-pill">${escapeHtml(r.name)}</span>`
        ).join('');
    }

    async function createRole() {
        const input = document.getElementById('newRoleName');
        const name = input.value.trim();
        if (!name) return;

        const res = await fetch('/api/admin/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to create role');
            return;
        }

        input.value = '';
        await loadRoles();
        await loadUsers(currentPage);
    }

    async function loadUsers(page) {
        currentPage = page;
        const res = await fetch(`/api/admin/users?page=${page}&pageSize=${pageSize}`);
        if (!res.ok) return;

        const data = await res.json();
        renderUsersTable(data.users);
        renderPagination(data.totalCount);
    }

    function renderUsersTable(users) {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = users.map(user => {
            const roleBadges = user.roles.map(r =>
                `<span class="role-badge">
                    ${escapeHtml(r.name)}
                    <button class="remove-role" onclick="adminRemoveRole(${user.id}, ${r.id})" title="Remove role">&times;</button>
                </span>`
            ).join('');

            const availableRoles = allRoles.filter(r => !user.roles.some(ur => ur.id === r.id));
            const addDropdown = availableRoles.length > 0
                ? `<div class="add-role-wrapper">
                       <button class="add-role-btn" onclick="toggleRoleDropdown(this)">+ Add Role</button>
                       <div class="add-role-dropdown">
                           ${availableRoles.map(r =>
                               `<button onclick="adminAddRole(${user.id}, ${r.id})">${escapeHtml(r.name)}</button>`
                           ).join('')}
                       </div>
                   </div>`
                : '';

            return `<tr>
                <td>${user.id}</td>
                <td>${escapeHtml(user.username)}</td>
                <td><div class="role-badges">${roleBadges}</div></td>
                <td>${addDropdown}</td>
            </tr>`;
        }).join('');
    }

    function renderPagination(totalCount) {
        const totalPages = Math.ceil(totalCount / pageSize);
        const container = document.getElementById('pagination');

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <button onclick="adminGoToPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
            <span class="page-info">Page ${currentPage} of ${totalPages}</span>
            <button onclick="adminGoToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        `;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Global functions for inline event handlers
    window.adminAddRole = async function (userId, roleId) {
        const res = await fetch(`/api/admin/users/${userId}/roles/${roleId}`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to add role');
            return;
        }
        await loadUsers(currentPage);
    };

    window.adminRemoveRole = async function (userId, roleId) {
        const res = await fetch(`/api/admin/users/${userId}/roles/${roleId}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to remove role');
            return;
        }
        await loadUsers(currentPage);
    };

    window.toggleRoleDropdown = function (btn) {
        const dropdown = btn.nextElementSibling;
        document.querySelectorAll('.add-role-dropdown.open').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    };

    window.adminGoToPage = function (page) {
        loadUsers(page);
    };
})();
