(function (app) {
    const { state } = app;

    state.timelineOffset = 0;
    state.timelineEvents = [];

    var TIMELINE_LIMIT = 100;

    var typeIcons = {
        document: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
        condition: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
        prescription: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>',
        bill: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'
    };

    var typeColors = {
        document: '#6366f1',
        condition: '#ef4444',
        prescription: '#22c55e',
        bill: '#f59e0b'
    };

    app.loadTimeline = async function () {
        state.timelineOffset = 0;
        state.timelineEvents = [];

        var personParam = state.selectedPersonId ? 'personId=' + state.selectedPersonId + '&' : '';
        var res = await fetch(app.API + '/timeline?' + personParam + 'offset=0&limit=' + TIMELINE_LIMIT);
        if (!res.ok) return;

        var events = await res.json();
        state.timelineEvents = events;
        state.timelineOffset = events.length;
        app.renderTimeline(events);

        var btn = document.getElementById('timelineLoadMore');
        if (btn) btn.style.display = events.length >= TIMELINE_LIMIT ? '' : 'none';
    };

    app.loadMoreTimeline = async function () {
        var morePersonParam = state.selectedPersonId ? 'personId=' + state.selectedPersonId + '&' : '';
        var res = await fetch(app.API + '/timeline?' + morePersonParam + 'offset=' + state.timelineOffset + '&limit=' + TIMELINE_LIMIT);
        if (!res.ok) return;

        var events = await res.json();
        state.timelineEvents = state.timelineEvents.concat(events);
        state.timelineOffset += events.length;
        app.renderTimeline(state.timelineEvents);

        var btn = document.getElementById('timelineLoadMore');
        if (btn) btn.style.display = events.length >= TIMELINE_LIMIT ? '' : 'none';
    };

    app.renderTimeline = function (events) {
        var container = document.getElementById('timelineList');
        if (!container) return;

        if (events.length === 0) {
            container.innerHTML = '<div class="empty-state">No timeline events yet.</div>';
            return;
        }

        // Group by month/year
        var groups = {};
        events.forEach(function (ev) {
            var d = ev.eventDate ? new Date(ev.eventDate) : new Date(ev.createdAt);
            var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            var label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
            if (!groups[key]) groups[key] = { label: label, items: [] };
            groups[key].items.push(ev);
        });

        var html = '';
        Object.keys(groups).sort().reverse().forEach(function (key) {
            var group = groups[key];
            html += '<div class="timeline-month">' + app.escapeHtml(group.label) + '</div>';
            group.items.forEach(function (ev) {
                var icon = typeIcons[ev.eventType] || typeIcons.document;
                var color = typeColors[ev.eventType] || '#6366f1';
                var dateStr = ev.eventDate ? app.formatDate(ev.eventDate) : app.formatDate(ev.createdAt);
                var subBadge = ev.subType
                    ? '<span class="timeline-badge" style="background:' + color + '">' + app.escapeHtml(app.formatLabel(ev.subType)) + '</span>'
                    : '';
                var typeBadge = '<span class="timeline-badge" style="background:' + color + ';opacity:0.7">' + app.escapeHtml(app.formatLabel(ev.eventType)) + '</span>';
                var detail = ev.detail ? '<div class="timeline-detail">' + app.escapeHtml(app.truncate(ev.detail, 120)) + '</div>' : '';

                html += '<div class="timeline-item" style="border-left-color:' + color + '">'
                    + '<div class="timeline-icon">' + icon + '</div>'
                    + '<div class="timeline-content">'
                    + '<div class="timeline-date">' + dateStr + ' ' + typeBadge + ' ' + subBadge + '</div>'
                    + '<div class="timeline-label">' + app.personBadge(ev.personId) + app.escapeHtml(ev.label || 'Untitled') + '</div>'
                    + detail
                    + '</div>'
                    + '</div>';
            });
        });

        container.innerHTML = html;
    };

    window.medDocsLoadMoreTimeline = function () { app.loadMoreTimeline(); };
})(MedDocs);
