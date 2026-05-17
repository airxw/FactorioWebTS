(function() {
    var playersAutoRefreshId = null;
    var playersAutoRefreshing = false;

    async function loadOnlinePlayers() {
        var grid = document.getElementById('online-players-grid');
        try {
            var res = await fetchAPI('/api/players/online');
            var d = await res.json();
            if (ApiResponse.isSuccess(d)) {
                var data = ApiResponse.getData(d);
                var players = data.players || data;
                renderOnlinePlayers(Array.isArray(players) ? players : []);
            } else {
                grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="bi bi-exclamation-triangle"></i><p>获取在线玩家失败</p></div>';
                document.getElementById('online-count-badge').textContent = '0 人';
            }
        } catch (e) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="bi bi-wifi-off"></i><p>网络错误: ' + escapeHtml(e.message) + '</p></div>';
            document.getElementById('online-count-badge').textContent = '0 人';
        }
    }

    function renderOnlinePlayers(players) {
        var grid = document.getElementById('online-players-grid');
        document.getElementById('online-count-badge').textContent = players.length + ' 人';
        if (!players || players.length === 0) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="bi bi-person-dash"></i><p>服务器上暂时没有在线玩家</p></div>';
            return;
        }
        grid.innerHTML = players.map(function(p) {
            return '<div class="player-card">' +
                '<div class="player-avatar"><i class="bi bi-person-fill"></i></div>' +
                '<div class="player-info"><div class="player-name">' + escapeHtml(p.name) + '</div><div class="player-duration">' + escapeHtml(p.duration || '--') + '</div></div>' +
                '<span class="player-online-dot"></span>' +
                '<button class="btn btn-outline-danger btn-sm" onclick="kickPlayer(\'' + escapeHtml(p.name) + '\')" title="踢出玩家"><i class="bi bi-box-arrow-right"></i></button>' +
            '</div>';
        }).join('');
    }

    async function kickPlayer(name) {
        showModal({title:'确认踢出玩家',content:'确定要踢出玩家 "'+name+'" 吗？',confirmText:'踢出',danger:true,onConfirm:function(){
            (async function(){
                try {
                    var res = await fetchAPI('/api/players/kick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) });
                    var d = await res.json();
                    ApiResponse.handleResponse(d,
                        function() {
                            showToast('已成功踢出玩家 ' + name, 'success');
                            loadOnlinePlayers();
                        },
                        function(error) {
                            showToast(error, 'error');
                        }
                    );
                } catch (e) { showToast('请求错误: ' + e.message, 'error'); }
            })();
        }});
    }

    async function loadPlayerLists() {
        try {
            var [adminsRes, bansRes, whitelistRes] = await Promise.all([
                fetchAPI('/api/players/admins'),
                fetchAPI('/api/players/bans'),
                fetchAPI('/api/players/whitelist')
            ]);
            var admins = await adminsRes.json();
            var bans = await bansRes.json();
            var whitelist = await whitelistRes.json();
            function getListData(response) {
                if (ApiResponse.isSuccess(response)) {
                    return ApiResponse.getData(response) || [];
                }
                return [];
            }
            renderPlayerTagList('admins-list-body', 'admins-count', getListData(admins));
            renderPlayerTagList('bans-list-body', 'bans-count', getListData(bans));
            renderPlayerTagList('whitelist-list-body', 'whitelist-count', getListData(whitelist));
        } catch (e) {
            ['admins-list-body','bans-list-body','whitelist-list-body'].forEach(function(id) {
                document.getElementById(id).innerHTML = '<span style="color:#e74c3c;font-size:0.82rem;">网络错误: ' + escapeHtml(e.message) + '</span>';
            });
        }
    }

    function renderPlayerTagList(bodyId, countId, list) {
        var body = document.getElementById(bodyId);
        var countEl = document.getElementById(countId);
        countEl.textContent = list.length;
        if (!list || list.length === 0) {
            body.innerHTML = '<span style="color:#7f8c8d;font-size:0.82rem;">暂无数据</span>';
            return;
        }
        body.innerHTML = list.map(function(item) { return '<span class="player-tag"><i class="bi bi-person"></i>' + escapeHtml(item) + '</span>'; }).join('');
    }

    function switchPlayersTab(tab) {
        document.querySelectorAll('.players-tab-btn').forEach(function(btn, i) {
            btn.classList.toggle('active', (tab === 'online' && i === 0) || (tab === 'lists' && i === 1));
        });
        document.getElementById('players-panel-online').classList.toggle('active', tab === 'online');
        document.getElementById('players-panel-lists').classList.toggle('active', tab === 'lists');
        if (tab === 'lists') loadPlayerLists();
    }

    function switchPlayerSubTab(sub) {
        var map = { admins: 0, bans: 1, whitelist: 2 };
        document.querySelectorAll('.player-sub-tab-btn').forEach(function(btn, i) { btn.classList.toggle('active', i === map[sub]); });
        document.getElementById('player-sub-admins').classList.toggle('active', sub === 'admins');
        document.getElementById('player-sub-bans').classList.toggle('active', sub === 'bans');
        document.getElementById('player-sub-whitelist').classList.toggle('active', sub === 'whitelist');
    }

    function startPlayersAutoRefresh() {
        stopPlayersAutoRefresh();
        playersAutoRefreshing = true;
        playersAutoRefreshId = setInterval(loadOnlinePlayers, 10000);
        updatePlayersAutoRefreshBtn();
    }

    function stopPlayersAutoRefresh() {
        if (playersAutoRefreshId) { clearInterval(playersAutoRefreshId); playersAutoRefreshId = null; }
        playersAutoRefreshing = false;
        updatePlayersAutoRefreshBtn();
    }

    function togglePlayersAutoRefresh() {
        if (playersAutoRefreshing) { stopPlayersAutoRefresh(); showToast('已关闭自动刷新', 'info'); }
        else { startPlayersAutoRefresh(); showToast('已开启自动刷新，每10秒刷新一次', 'success'); }
    }

    function updatePlayersAutoRefreshBtn() {
        var btn = document.getElementById('players-auto-refresh-btn');
        if (!btn) return;
        if (playersAutoRefreshing) {
            btn.classList.remove('btn-outline-success');
            btn.classList.add('btn-success');
            btn.innerHTML = '<i class="bi bi-pause-circle me-1"></i>暂停自动刷新';
        } else {
            btn.classList.remove('btn-success');
            btn.classList.add('btn-outline-success');
            btn.innerHTML = '<i class="bi bi-repeat me-1"></i>开启自动刷新';
        }
    }

    window.loadOnlinePlayers = loadOnlinePlayers;
    window.kickPlayer = kickPlayer;
    window.loadPlayerLists = loadPlayerLists;
    window.switchPlayersTab = switchPlayersTab;
    window.switchPlayerSubTab = switchPlayerSubTab;
    window.togglePlayersAutoRefresh = togglePlayersAutoRefresh;

    document.addEventListener('DOMContentLoaded', function() {
        checkSession({ 
            requireAuth: true,
            onValid: function(userData) {
                if (userData.role !== 'admin') {
                    showToast('权限不足，只有管理员才能访问此页面', 'error');
                    setTimeout(function() {
                        window.location.href = 'profile.html';
                    }, 1500);
                    return;
                }
                SidebarMenu.initSidebarWithPermission();
                loadOnlinePlayers();
                loadPlayerLists();
            }
        });
    });

    window.addEventListener('beforeunload', function() {
        stopPlayersAutoRefresh();
    });
})();