(function() {
    var currentTab = 'login';

    function showToast(msg, type) {
        var container = document.getElementById('toast-container');
        if (!container) { 
            container = document.createElement('div'); 
            container.id = 'toast-container'; 
            container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;'; 
            document.body.appendChild(container); 
        }
        var iconMap = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-circle',
            info: 'info-circle'
        };
        var icon = iconMap[type] || 'info-circle';
        var toast = document.createElement('div');
        toast.className = 'toast-item toast-' + (type || 'info');
        toast.innerHTML = '<div class="toast-body"><div class="toast-icon"><i class="bi bi-' + icon + '"></i></div><div class="toast-message">' + escapeHtml(msg) + '</div></div><button class="toast-close">&times;</button><div class="toast-progress"></div>';
        container.appendChild(toast);
        var timer = setTimeout(function() { 
            if (toast.parentNode) {
                toast.classList.add('removing');
                setTimeout(function() { toast.remove(); }, 300);
            }
        }, 3000);
        toast.querySelector('.toast-close').addEventListener('click', function() { 
            clearTimeout(timer); 
            toast.classList.add('removing');
            setTimeout(function() { toast.remove(); }, 300);
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        var tabs = document.querySelectorAll('.auth-tab');
        tabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                switchTab(this.dataset.tab);
            });
        });

        document.getElementById('login-form').addEventListener('submit', handleLogin);
        document.getElementById('register-form').addEventListener('submit', handleRegister);

        checkSession({
            onValid: function() {
                window.location.href = 'dashboard.html';
            }
        });
    });

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.auth-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.auth-form').forEach(function(f) { f.classList.add('hidden'); });

        document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
        document.getElementById(tab + '-form').classList.remove('hidden');
    }

    function handleLogin(e) {
        e.preventDefault();

        var username = document.getElementById('login-username').value.trim();
        var password = document.getElementById('login-password').value;

        if (!username || !password) {
            showToast('请填写用户名和密码', 'warning');
            return;
        }

        fetchAPI('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(function(res) { return res.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    TokenManager.setToken(data.token);
                    TokenManager.setUserInfo(data.user);
                    window.location.href = 'dashboard.html';
                },
                function(error) {
                    showToast('登录失败：' + error, 'error');
                }
            );
        })
        .catch(function(error) {
            console.error('Error logging in:', error);
            showToast('登录失败', 'error');
        });
    }

    function handleRegister(e) {
        e.preventDefault();

        var username = document.getElementById('register-username').value.trim();
        var password = document.getElementById('register-password').value;
        var confirm = document.getElementById('register-confirm').value;
        var name = document.getElementById('register-name').value.trim();

        if (!username || !password) {
            showToast('请填写用户名和密码', 'warning');
            return;
        }

        if (password !== confirm) {
            showToast('两次输入的密码不一致', 'warning');
            return;
        }

        fetchAPI('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password, name: name })
        })
        .then(function(res) { return res.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    TokenManager.setToken(data.token);
                    TokenManager.setUserInfo(data.user);
                    showToast('注册成功！', 'success');
                    window.location.href = 'dashboard.html';
                },
                function(error) {
                    showToast('注册失败：' + error, 'error');
                }
            );
        })
        .catch(function(error) {
            console.error('Error registering:', error);
            showToast('注册失败', 'error');
        });
    }
})();