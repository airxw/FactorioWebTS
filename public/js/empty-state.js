var EmptyState = (function() {
    var SVG_ICONS = {
        empty: '<svg viewBox="0 0 64 64" width="64" height="64"><rect x="8" y="8" width="48" height="48" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><rect x="14" y="4" width="12" height="4" rx="2" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
        search: '<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="26" cy="26" r="16" stroke="currentColor" stroke-width="2" fill="none"/><line x1="38" y1="38" x2="54" y2="54" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        error: '<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="24" stroke="currentColor" stroke-width="2" fill="none"/><line x1="22" y1="22" x2="42" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="42" y1="22" x2="22" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        cart: '<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="22" cy="56" r="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="46" cy="56" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 8h8l5 36h30l8-24H14" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>'
    };

    function show(container, options) {
        options = options || {};
        var message = options.message || '暂无数据';
        var icon = options.icon || 'empty';
        var actionText = options.actionText || '';
        var actionCallback = options.actionCallback || null;

        container.innerHTML = '';

        var emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';

        var iconDiv = document.createElement('div');
        iconDiv.className = 'empty-state-icon';
        iconDiv.innerHTML = SVG_ICONS[icon] || SVG_ICONS.empty;
        emptyDiv.appendChild(iconDiv);

        var textDiv = document.createElement('div');
        textDiv.className = 'empty-state-text';
        textDiv.textContent = message;
        emptyDiv.appendChild(textDiv);

        if (actionText && typeof actionCallback === 'function') {
            var btn = document.createElement('button');
            btn.className = 'empty-state-action';
            btn.textContent = actionText;
            btn.addEventListener('click', actionCallback);
            emptyDiv.appendChild(btn);
        }

        container.appendChild(emptyDiv);
    }

    function showById(elementId, options) {
        var el = document.getElementById(elementId);
        if (el) show(el, options);
    }

    return { show: show, showById: showById };
})();

window.EmptyState = EmptyState;