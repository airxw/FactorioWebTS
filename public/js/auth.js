window.__isRedirectingToLogin = false;

function getAuthHeaders() {
    return TokenManager.getAuthHeaders();
}

function checkSession(options) {
    options = options || {};
    var token = TokenManager.getToken();

    if (!token) {
        if (options.requireAuth) {
            window.location.href = 'login.html';
        }
        if (options.onInvalid) options.onInvalid();
        return;
    }

    fetch('/api/auth/validate', {
        headers: getAuthHeaders()
    })
    .then(function(response) {
        if (response.status === 401) {
            handleUnauthorized();
            if (options.requireAuth) {
                window.location.href = 'login.html';
            }
            if (options.onInvalid) options.onInvalid();
            return null;
        }
        return response.json();
    })
    .then(function(data) {
        if (!data) return;
        ApiResponse.handleResponse(data,
            function(responseData) {
                if (options.onValid) options.onValid(responseData);
            },
            function() {
                TokenManager.removeToken();
                TokenManager.removeUserInfo();
                if (options.requireAuth) {
                    window.location.href = 'login.html';
                }
                if (options.onInvalid) options.onInvalid();
            }
        );
    })
    .catch(function(error) {
        if (window.__isRedirectingToLogin) {
            return;
        }
        console.error('Session validation failed:', error);
        if (options.requireAuth) {
            window.location.href = 'login.html';
        }
        if (options.onInvalid) options.onInvalid();
    });
}

function handleUnauthorized() {
    if (window.__isRedirectingToLogin) {
        return;
    }
    window.__isRedirectingToLogin = true;
    TokenManager.removeToken();
    TokenManager.removeUserInfo();
    showToast('登录已过期，请重新登录', 'warning');
    window.location.href = 'login.html';
}

function fetchAPI(url, options) {
    options = options || {};
    var headers = Object.assign({}, getAuthHeaders(), options.headers || {});
    headers['X-Requested-With'] = 'XMLHttpRequest';

    var fetchOptions = Object.assign({}, options, { headers: headers });

    return fetch(url, fetchOptions)
        .then(function(response) {
            if (response.status === 401) {
                handleUnauthorized();
                throw new Error('Unauthorized');
            }
            return response;
        });
}

// ============================================================
// Button Ripple Effect
// ============================================================
(function() {
    function createRipple(btn, e) {
        if (btn.classList.contains('btn-no-ripple')) return;
        
        var ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        
        var x = (e.clientX || (e.touches && e.touches[0].clientX) || rect.width / 2) - rect.left - size / 2;
        var y = (e.clientY || (e.touches && e.touches[0].clientY) || rect.height / 2) - rect.top - size / 2;
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        
        btn.appendChild(ripple);
        
        ripple.addEventListener('animationend', function() {
            if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
        });
    }
    
    document.addEventListener('mousedown', function(e) {
        var btn = e.target.closest('.btn');
        if (btn) createRipple(btn, e);
    });
    
    document.addEventListener('touchstart', function(e) {
        var btn = e.target.closest('.btn');
        if (btn) createRipple(btn, e);
    }, { passive: true });
})();

function loadingButton(btn) {
    if (!btn) return;
    btn._originalText = btn.textContent;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.textContent = '';
}

function resetButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = btn._originalText || btn.textContent;
}

window.getAuthHeaders = getAuthHeaders;
window.checkSession = checkSession;
window.fetchAPI = fetchAPI;
window.handleUnauthorized = handleUnauthorized;
window.loadingButton = loadingButton;
window.resetButton = resetButton;
