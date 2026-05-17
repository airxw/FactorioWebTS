var Toast = {
    init: function() {
        if (document.querySelector('.toast-container')) return;
        var container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    },
    show: function(msg, type) {
        type = type || 'info';
        var validTypes = ['success', 'error', 'warning', 'info'];
        if (validTypes.indexOf(type) === -1) {
            type = 'info';
        }

        var container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        var svgIcons = {
            success: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="white" stroke-width="2"/><path d="M6 10l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            error: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="white" stroke-width="2"/><path d="M7 7l6 6M13 7l-6 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            warning: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3L2 18h16L10 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v3M10 14v0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="white" stroke-width="2"/><path d="M10 9v5M10 6v0" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>'
        };

        var toast = document.createElement('div');
        toast.className = 'toast-item toast-' + type;
        toast.innerHTML = '<div class="toast-icon">' + svgIcons[type] + '</div>' +
            '<div class="toast-body">' +
            '<div class="toast-message">' + AppHelpers.escapeHtml(msg) + '</div>' +
            '</div>' +
            '<button class="toast-close">&times;</button>' +
            '<div class="toast-progress"></div>';

        container.appendChild(toast);

        var timer = setTimeout(function () {
            removeToast(toast);
        }, 3000);

        var closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', function () {
            removeToast(toast);
        });

        function removeToast(el) {
            if (el._removing) return;
            el._removing = true;
            clearTimeout(timer);
            el.classList.add('removing');
            el.addEventListener('animationend', function () {
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            });
        }
    }
};

var AppHelpers = {
    escapeHtml: function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    formatTs: function(ts) {
        if (!ts) return '--';
        var d = new Date(ts * 1000);
        var pad = function(n) { return n < 10 ? '0' + n : n; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    },

    authHeaders: function() {
        return TokenManager.getAuthHeaders();
    },

    logout: function() {
        TokenManager.clear();
        window.location.href = 'login.html';
    }
};

window.showToast = function(msg, type) {
    Toast.show(msg, type);
};

window.escapeHtml = AppHelpers.escapeHtml;

window.logout = AppHelpers.logout;

window.formatTs = AppHelpers.formatTs;

var ApiResponse = (function() {
    'use strict';

    function isSuccess(response) {
        if (!response) {
            return false;
        }

        if (typeof response.success === 'boolean') {
            return response.success;
        }

        return false;
    }

    function getData(response) {
        if (!response) {
            return null;
        }

        if (response.data !== undefined) {
            return response.data;
        }

        return response;
    }

    function getError(response) {
        if (!response) {
            return '未知错误';
        }

        if (response.error) {
            return response.error;
        }

        if (response.message) {
            return response.message;
        }

        if (response.data && response.data.message) {
            return response.data.message;
        }

        return '未知错误';
    }

    function handleResponse(response, onSuccess, onError) {
        if (isSuccess(response)) {
            var data = getData(response);
            if (typeof onSuccess === 'function') {
                onSuccess(data);
            }
        } else {
            var error = getError(response);
            if (typeof onError === 'function') {
                onError(error);
            } else {
                console.error('API请求失败:', error);
            }
        }
    }

    return {
        isSuccess: isSuccess,
        getData: getData,
        getError: getError,
        handleResponse: handleResponse
    };
})();