var Skeleton = (function() {
    function show(container, type, rowCount) {
        container.innerHTML = '';

        var fragment = document.createDocumentFragment();
        var i, div;

        if (type === 'table') {
            var rows = rowCount || 5;
            div = document.createElement('div');
            div.className = 'skeleton skeleton-row';
            div.style.height = '40px';
            fragment.appendChild(div);

            for (i = 0; i < rows; i++) {
                div = document.createElement('div');
                div.className = 'skeleton skeleton-row';
                fragment.appendChild(div);
            }
        } else if (type === 'card') {
            div = document.createElement('div');
            div.className = 'skeleton skeleton-card';
            fragment.appendChild(div);

            div = document.createElement('div');
            div.className = 'skeleton skeleton-title';
            div.style.marginTop = '12px';
            fragment.appendChild(div);

            div = document.createElement('div');
            div.className = 'skeleton skeleton-text';
            fragment.appendChild(div);

            div = document.createElement('div');
            div.className = 'skeleton skeleton-text';
            div.style.width = '60%';
            fragment.appendChild(div);
        } else {
            for (i = 0; i < 3; i++) {
                div = document.createElement('div');
                div.className = 'skeleton skeleton-text';
                fragment.appendChild(div);
            }
        }

        container.appendChild(fragment);
        return container.firstChild;
    }

    function hide(container) {
        container.innerHTML = '';
    }

    function auto(container, type, rowCount) {
        show(container, type, rowCount);
        return function() { hide(container); };
    }

    return { show: show, hide: hide, auto: auto };
})();

window.Skeleton = Skeleton;