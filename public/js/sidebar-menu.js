var SidebarMenu = (function() {
    (function() {
        if (localStorage.getItem('sidebar_collapsed') === 'true') {
            document.documentElement.classList.add('sidebar-init');
            var s = document.getElementById('sidebar');
            var m = document.querySelector('.main-content');
            if (s) s.classList.add('collapsed');
            if (m) m.classList.add('collapsed');
        }
    })();

    var menuItems = [
        {
            id: 'dashboard',
            label: '控制台',
            href: 'dashboard.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'
        },
        {
            id: 'server-control',
            label: '服务器控制',
            href: 'server-control.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>'
        },
        {
            id: 'players',
            label: '玩家管理',
            href: 'players.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
        },
        {
            id: 'saves',
            label: '存档管理',
            href: 'saves.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>'
        },
        {
            id: 'items',
            label: '物品管理',
            href: 'items.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>'
        },
        {
            id: 'item-requests',
            label: '物品请求审批',
            href: 'item-requests.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>'
        },
        {
            id: 'shop',
            label: '商店',
            href: 'shop.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>'
        },
        {
            id: 'vip',
            label: 'VIP系统',
            href: 'vip.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'
        },
        {
            id: 'vote',
            label: '投票管理',
            href: 'vote.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>'
        },
        {
            id: 'config',
            label: '配置管理',
            href: 'config.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51z"></path></svg>'
        },
        {
            id: 'mod',
            label: '模组管理',
            href: 'mod.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 3a1 1 0 0 0-1.196-.98l-10 2A1 1 0 0 0 6 5v9.114A4.369 4.369 0 0 0 5 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0 0 15 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"></path></svg>'
        },
        {
            id: 'console',
            label: 'RCON控制台',
            href: 'console.html',
            conditional: true,
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'
        },
        {
            id: 'users',
            label: '用户管理',
            href: 'users.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
        },
        {
            id: 'profile',
            label: '个人中心',
            href: 'profile.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
        },
        {
            id: 'periodic-messages',
            label: '周期消息',
            href: 'periodic-messages.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
        },
        {
            id: 'chat-settings',
            label: '聊天设置',
            href: 'chat-settings.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>'
        },
        {
            id: 'server-responses',
            label: '服务器响应',
            href: 'server-responses.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>'
        },
        {
            id: 'logs',
            label: '日志查看',
            href: 'logs.html',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'
        }
    ];

    var PERMISSION_CACHE_KEY = 'sidebar_permissions';
    var PERMISSION_CACHE_TTL = 5 * 60 * 1000;

    function getUserRole() {
        try {
            var userInfo = localStorage.getItem('user_info');
            if (userInfo) {
                var parsed = JSON.parse(userInfo);
                return parsed.role || 'user';
            }
        } catch (e) {
            console.error('Failed to parse user_info:', e);
        }
        return 'user';
    }

    function getCachedPermissions() {
        try {
            var cached = localStorage.getItem(PERMISSION_CACHE_KEY);
            if (cached) {
                var data = JSON.parse(cached);
                if (Date.now() - data.timestamp < PERMISSION_CACHE_TTL) {
                    return data.visiblePages;
                }
            }
        } catch (e) {
            console.error('Failed to parse cached permissions:', e);
        }
        return null;
    }

    function cachePermissions(visiblePages) {
        try {
            localStorage.setItem(PERMISSION_CACHE_KEY, JSON.stringify({
                visiblePages: visiblePages,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('Failed to cache permissions:', e);
        }
    }

    var _pendingFetch = null;

    function fetchPermissionsFromServer() {
        var token = TokenManager.getToken();
        if (!token) return Promise.resolve(null);

        if (_pendingFetch) return _pendingFetch;

        _pendingFetch = fetch('/api/auth/my-permissions', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(function(response) {
            if (!response.ok) return null;
            return response.json();
        })
        .then(function(data) {
            if (data && ApiResponse.isSuccess(data)) {
                var visiblePages = ApiResponse.getData(data).visible_pages;
                cachePermissions(visiblePages);
                return visiblePages;
            }
            return null;
        })
        .catch(function(err) {
            if (err && err.name !== 'AbortError') {
                console.warn('Failed to fetch permissions:', err.message);
            }
            return null;
        })
        .finally(function() {
            _pendingFetch = null;
        });

        return _pendingFetch;
    }

    function getVisiblePages() {
        var role = getUserRole();
        if (role === 'admin') {
            return menuItems.map(function(item) { return item.id; });
        }

        var cached = getCachedPermissions();
        if (cached) return cached;

        return null;
    }

    function isServerRunning() {
        try {
            return localStorage.getItem('server_running') === 'true';
        } catch (e) {
            return false;
        }
    }

    var COLLAPSED_KEY = 'sidebar_collapsed';

    function isCollapsed() {
        return localStorage.getItem(COLLAPSED_KEY) === 'true';
    }

    function setCollapsed(collapsed) {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? 'true' : 'false');
    }

    function renderSidebar(activePage, visiblePages) {
        var sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        var filteredItems;
        if (visiblePages) {
            filteredItems = menuItems.filter(function(item) {
                return visiblePages.indexOf(item.id) !== -1;
            });
        } else {
            filteredItems = menuItems;
        }

        var html = '';
        html += '<div class="sidebar-header">';
        html += '<button class="sidebar-toggle" id="sidebar-toggle" aria-label="切换侧边栏">';
        html += '<span class="sidebar-toggle-bar"></span>';
        html += '<span class="sidebar-toggle-bar"></span>';
        html += '<span class="sidebar-toggle-bar"></span>';
        html += '</button>';
        html += '<div class="sidebar-brand">';
        html += '<div class="sidebar-brand-icon">';
        html += '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">';
        html += '<circle cx="12" cy="12" r="3"></circle>';
        html += '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51z"></path>';
        html += '</svg>';
        html += '</div>';
        html += '<div class="sidebar-brand-text">';
        html += '<h1>FactorioWeb</h1>';
        html += '<small>Server Manager</small>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="sidebar-brand-divider"></div>';

        html += '<ul class="sidebar-menu">';

        filteredItems.forEach(function(item) {
            var isActive = item.id === activePage;
            html += '<li class="sidebar-menu-item">';
            html += '<a href="' + item.href + '" class="sidebar-menu-link' + (isActive ? ' active' : '') + '" data-tooltip="' + item.label + '">';
            html += '<div class="sidebar-menu-icon">' + item.icon + '</div>';
            html += '<span class="sidebar-menu-text">' + item.label + '</span>';
            html += '</a>';
            html += '</li>';
        });

        html += '</ul>';

        html += '<div class="sidebar-footer">';
        html += '<span class="sidebar-footer-version">FactorioWeb v1.0</span>';
        html += '<span class="sidebar-footer-copy">&copy; Factorio Server Manager</span>';
        html += '</div>';

        sidebar.innerHTML = html;

        if (isCollapsed()) {
            sidebar.classList.add('collapsed');
            var mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.classList.add('collapsed');
            }
        }
    }

    function checkPagePermission(pageId) {
        var role = getUserRole();
        if (role === 'admin') return true;

        var visiblePages = getVisiblePages();
        if (visiblePages && visiblePages.indexOf(pageId) !== -1) return true;

        window.location.href = 'dashboard.html';
        return false;
    }

    function getCurrentPageId() {
        var path = window.location.pathname;
        var filename = path.substring(path.lastIndexOf('/') + 1);
        return filename.replace('.html', '');
    }

    function initSidebarToggle() {
        var sidebar = document.getElementById('sidebar');
        var sidebarToggle = document.getElementById('sidebar-toggle');
        var mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        var mainContent = document.querySelector('.main-content');

        if (!sidebar || !sidebarToggle) return;

        var overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebar-overlay';
        document.body.appendChild(overlay);

        function closeSidebar() {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        }

        function openSidebar() {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
        }

        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.toggle('collapsed');
            if (mainContent) {
                mainContent.classList.toggle('collapsed');
            }
            setCollapsed(sidebar.classList.contains('collapsed'));
        });

        if (mobileMenuToggle) {
            mobileMenuToggle.addEventListener('click', function() {
                if (sidebar.classList.contains('open')) {
                    closeSidebar();
                } else {
                    openSidebar();
                }
            });
        }

        overlay.addEventListener('click', function() {
            closeSidebar();
        });

        if (mainContent) {
            mainContent.addEventListener('click', function(e) {
                if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
                    if (!sidebar.contains(e.target) && e.target !== mobileMenuToggle) {
                        closeSidebar();
                    }
                }
            });
        }

        window.addEventListener('resize', function() {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
        });

        var sidebarLinks = sidebar.querySelectorAll('.sidebar-menu-link');
        sidebarLinks.forEach(function(link) {
            link.addEventListener('mousedown', function() {
                link.classList.add('clicked');
            });

            link.addEventListener('mouseup', function() {
                setTimeout(function() {
                    link.classList.remove('clicked');
                }, 350);
            });

            link.addEventListener('mouseleave', function() {
                link.classList.remove('clicked');
            });

            link.addEventListener('click', function(e) {
                if (window.innerWidth <= 768) {
                    closeSidebar();
                }
            });
        });

        requestAnimationFrame(function() {
            document.documentElement.classList.remove('sidebar-init');
        });
    }

    function initSidebarWithPermission() {
        var currentPage = getCurrentPageId();
        var role = getUserRole();

        if (role !== 'admin') {
            var visiblePages = getVisiblePages();
            if (!visiblePages) {
                fetchPermissionsFromServer().then(function(pages) {
                    if (pages) {
                        if (pages.indexOf(currentPage) === -1) {
                            window.location.href = 'dashboard.html';
                            return;
                        }
                        renderSidebar(currentPage, pages);
                        initSidebarToggle();
                    } else {
                        renderSidebar(currentPage);
                        initSidebarToggle();
                    }
                });
                return;
            }

            if (visiblePages.indexOf(currentPage) === -1) {
                window.location.href = 'dashboard.html';
                return;
            }

            renderSidebar(currentPage, visiblePages);
            initSidebarToggle();
        } else {
            fetchPermissionsFromServer().then(function() {
                renderSidebar(currentPage);
                initSidebarToggle();
            });
        }
    }

    return {
        renderSidebar: renderSidebar,
        checkPagePermission: checkPagePermission,
        getCurrentPageId: getCurrentPageId,
        initSidebarWithPermission: initSidebarWithPermission,
        initSidebarToggle: initSidebarToggle,
        isServerRunning: isServerRunning,
        refresh: function() {
            var currentPage = getCurrentPageId();
            var visiblePages = getVisiblePages();
            renderSidebar(currentPage, visiblePages);
        }
    };
})();