(function() {
    var theme = localStorage.getItem('theme');
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

var versionListData = [];
var serverState = 'unknown';
var stateReceived = false;
var isOperating = false;
var STATE_DISABLE_ALL = ['unknown', 'starting', 'stopping'];

document.addEventListener('DOMContentLoaded', function() {
    checkUserRole();

    wsClient.onReconnect(function() {
        console.log('WebSocket reconnected, fetching latest state...');
        updateServerStatus();
        loadSystemStats();
    });

    wsClient.on('server_state', function(data) {
        onServerStateMessage(data);
    });

    wsClient.connect();

    updateServerStatus();
    loadSystemStats();

    wsClient.on('log', function(data) {
        addLogItem(data);
    });

    wsClient.on('open', function() {
        console.log('WebSocket connected');
    });

    wsClient.on('close', function() {
        console.log('WebSocket disconnected');
    });

    setInterval(updateServerStatus, 5000);
    setInterval(loadSystemStats, 10000);
});

function onServerStateMessage(data) {
    if (!data || !data.state) return;
    stateReceived = true;
    serverState = data.state;
    updateButtonStates();
}

function updateButtonStates() {
    var startBtn = document.getElementById('start-btn');
    var stopBtn = document.getElementById('stop-btn');
    var saveBtn = document.getElementById('save-btn');

    if (!stateReceived) {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        return;
    }

    if (isOperating) {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        return;
    }

    if (STATE_DISABLE_ALL.indexOf(serverState) >= 0) {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    } else if (serverState === 'off' || serverState === 'error') {
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    } else if (serverState === 'running') {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

function checkUserRole() {
    try {
        var userInfo = JSON.parse(localStorage.getItem('user_info'));
        if (userInfo && userInfo.role === 'user') {
            var actionsContainer = document.getElementById('status-actions');
            if (actionsContainer) {
                actionsContainer.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('解析用户信息失败:', e);
    }
}

function updateServerStatus() {
    var token = localStorage.getItem('session_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    fetchAPI('/api/server/status')
        .then(function(response) { return response.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    updateStatusDisplay(data.running, data.version);
                },
                function(error) {
                    if (window.__isRedirectingToLogin) {
                        return;
                    }
                    console.error('获取服务端状态失败:', error);
                }
            );
        })
        .catch(function(err) {
            if (window.__isRedirectingToLogin) {
                return;
            }
            console.error('获取服务端状态失败:', err);
        });
}

function updateStatusDisplay(running, version) {
    var statusElement = document.getElementById('server-status');
    var versionElement = document.getElementById('server-version');

    statusElement.textContent = running ? '运行中' : '已停止';
    statusElement.className = 'status-indicator ' + (running ? 'status-online' : 'status-offline');

    if (version) {
        versionElement.textContent = '版本: ' + version;
    }

    updateButtonStates();
}

function loadServerVersion() {
    fetchAPI('/api/versions/current')
        .then(function(response) { return response.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    var versionData = data;
                    var versionElement = document.getElementById('server-version');
                    if (versionElement) {
                        versionElement.textContent = '版本: ' + (versionData.version || '未知');
                    }
                }
            );
        });
}

function startServer() {
    if (!stateReceived) {
        showToast('服务端状态未就绪，无法启动', 'error');
        return;
    }
    if (serverState !== 'off' && serverState !== 'error') {
        showToast('当前状态不允许启动', 'error');
        return;
    }
    isOperating = true;
    updateButtonStates();
    fetchAPI('/api/server/start', { method: 'POST' }).then(function(res) { return res.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function() {
                    showToast('启动命令已发送', 'success');
                    updateServerStatus();
                },
                function(error) {
                    showToast('启动失败: ' + error, 'error');
                    isOperating = false;
                    updateButtonStates();
                }
            );
        })
        .catch(function(err) {
            showToast('启动请求失败', 'error');
            console.error('启动服务端失败:', err);
            isOperating = false;
            updateButtonStates();
        });
}

function stopServer() {
    if (!stateReceived) {
        showToast('服务端状态未就绪，无法停止', 'error');
        return;
    }
    if (serverState !== 'running') {
        showToast('当前状态不允许停止', 'error');
        return;
    }
    showModal({title:'确认停止',content:'确定要停止服务端吗？',confirmText:'停止',danger:true,onConfirm:function(){
        isOperating = true;
        updateButtonStates();
        fetchAPI('/api/server/stop', { method: 'POST' }).then(function(res) { return res.json(); })
            .then(function(response) {
                ApiResponse.handleResponse(response,
                    function() {
                        showToast('服务端已停止', 'success');
                        updateServerStatus();
                    },
                    function(error) {
                        showToast('停止失败: ' + error, 'error');
                        isOperating = false;
                        updateButtonStates();
                    }
                );
            })
            .catch(function(err) {
                showToast('停止请求失败', 'error');
                console.error('停止服务端失败:', err);
                isOperating = false;
                updateButtonStates();
            });
    }});
}

function saveServer() {
    fetchAPI('/api/server/save', { method: 'POST' }).then(function(res) { return res.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function() {
                    showToast('保存成功', 'success');
                },
                function(error) {
                    showToast('保存失败: ' + error, 'error');
                }
            );
        })
        .catch(function(err) {
            showToast('保存请求失败', 'error');
            console.error('保存服务端失败:', err);
        });
}

function logout() {
    TokenManager.clear();
    window.location.href = 'login.html';
}

function addLogItem(data) {
    var logContainer = document.getElementById('log-container');
    var logItem = document.createElement('div');
    logItem.className = 'log-item';

    if (data.level === 'ERROR') {
        logItem.classList.add('log-error');
    } else if (data.level === 'WARNING') {
        logItem.classList.add('log-warning');
    } else if (data.level === 'INFO') {
        logItem.classList.add('log-info');
    } else {
        logItem.classList.add('log-default');
    }

    var date = new Date(data.timestamp * 1000);
    var timeString = date.toLocaleString();

    logItem.textContent = '[' + timeString + '] [' + data.level + '] ' + data.message;

    logContainer.appendChild(logItem);

    while (logContainer.children.length > 1000) {
        logContainer.removeChild(logContainer.firstChild);
    }

    logContainer.scrollTop = logContainer.scrollHeight;
}

async function loadSystemStats() {
    try {
        const token = localStorage.getItem('session_token');
        if (!token) {
            window.location.href = 'login.html';
            return;
        }

        const response = await fetchAPI('/api/server/stats');
        const result = await response.json();

        if (!ApiResponse.isSuccess(result)) {
            if (window.__isRedirectingToLogin) {
                return;
            }
            console.error('Failed to load system stats:', ApiResponse.getError(result));
            return;
        }

        var data = ApiResponse.getData(result);
        if (data) {
            updateMonitorCard('cpu', data.cpu_percent || 0);
            updateMonitorCard('memory', data.memory_percent || 0);
            updateMonitorCard('disk', data.disk_percent || 0);
            updatePlayerCount(data.online_players || 0);
        }
    } catch (e) {
        if (window.__isRedirectingToLogin) {
            return;
        }
        console.error('Failed to load system stats:', e);
    }
}

function updateMonitorCard(type, percent) {
    var bar = document.getElementById(type + '-progress-bar');
    var text = document.getElementById(type + '-percent');
    if (!bar || !text) return;

    var clampedPercent = Math.min(100, Math.max(0, percent));
    bar.style.width = clampedPercent + '%';
    text.textContent = clampedPercent + '%';

    bar.classList.remove('progress-green', 'progress-yellow', 'progress-red');
    if (clampedPercent < 60) {
        bar.classList.add('progress-green');
    } else if (clampedPercent < 80) {
        bar.classList.add('progress-yellow');
    } else {
        bar.classList.add('progress-red');
    }
}

function updatePlayerCount(count) {
    var el = document.getElementById('player-count');
    if (el) {
        el.textContent = count;
    }
}

function formatDate(timestamp) {
    if (!timestamp) return '-';
    var date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN');
}

function checkVersionUpdate(event) {
    var btn = document.getElementById('check-version-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '检查中...';
    }

    fetchAPI('/api/versions/latest?release_type=experimental')
        .then(function(response) { return response.json(); })
        .then(function(response) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '检查更新';
            }

            ApiResponse.handleResponse(response,
                function(data) {
                    renderLatestVersion(data);
                },
                function(error) {
                    showToast('检查更新失败: ' + error, 'error');
                }
            );
        })
        .catch(function(error) {
            console.error('Version check error:', error);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '检查更新';
            }
            showToast('检查更新失败: 网络请求错误', 'error');
        });
}

function refreshServerStatus() {
    var statusElement = document.getElementById('server-status');
    if (!statusElement) return;
    statusElement.textContent = '加载中...';
    statusElement.className = 'status-indicator status-loading';

    fetchAPI('/api/server/status')
        .then(function(response) { return response.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    var running = data.running;
                    var version = data.version;
                    serverState = data.state || 'unknown';
                    stateReceived = true;
                    updateButtonStates();
                    statusElement.textContent = running ? '运行中' : '已停止';
                    statusElement.className = 'status-indicator ' + (running ? 'status-online' : 'status-offline');
                    var versionElement = document.getElementById('server-version');
                    if (versionElement && version) {
                        versionElement.textContent = '版本: ' + version;
                    }
                },
                function() {
                    statusElement.textContent = '获取失败';
                    statusElement.className = 'status-indicator status-offline';
                }
            );
        })
        .catch(function(err) {
            statusElement.textContent = '获取失败';
            statusElement.className = 'status-indicator status-offline';
        });
}

function loadCurrentVersion() {
    fetchAPI('/api/versions/current')
        .then(function(response) { return response.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    var versionData = data;
                    document.getElementById('current-version').textContent = versionData.version || '未知';
                    if (versionData.is_installed) {
                        document.getElementById('version-status').textContent = '已安装';
                        document.getElementById('version-status').className = 'badge badge-success';
                    } else {
                        document.getElementById('version-status').textContent = '未安装';
                        document.getElementById('version-status').className = 'badge badge-warning';
                    }
                    document.getElementById('is-default-version').textContent = versionData.is_default ? '是' : '否';
                    document.getElementById('is-default-version').className = versionData.is_default ? 'badge badge-success' : 'badge badge-secondary';
                },
                function() {
                    showToast('获取版本信息失败', 'error');
                }
            );
        })
        .catch(function(error) {
            console.error('Error loading current version:', error);
            showToast('获取版本信息失败', 'error');
        });
}

function loadVersionList() {
    var tbody = document.getElementById('version-list-body');
    fetchAPI('/api/versions')
        .then(function(response) { return response.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    versionListData = data;
                    renderVersionList(data);
                },
                function(error) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center">加载失败: ' + escapeHtml(error) + '</td></tr>';
                    showToast('获取版本列表失败', 'error');
                }
            );
        })
        .catch(function(error) {
            console.error('Error loading version list:', error);
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">加载失败: 网络错误</td></tr>';
            showToast('获取版本列表失败', 'error');
        });
}

function renderVersionList(versions) {
    var tbody = document.getElementById('version-list-body');
    if (!versions || versions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">暂无已安装的版本</td></tr>';
        return;
    }

    var html = versions.map(function(ver) {
        var isCurrent = ver.is_current === true;
        var isDefault = ver.is_default === true;
        var isInstalled = ver.is_installed === true;
        var isRunning = ver.is_running === true;
        var size = ver.size_bytes ? (ver.size_bytes / (1024 * 1024)).toFixed(2) + ' MB' : '未知';

        return '<tr>' +
            '<td>' +
                '<span class="version-tag' + (isCurrent ? ' version-current' : '') + (isDefault ? ' version-default' : '') + '">' + escapeHtml(ver.version) + '</span>' +
            '</td>' +
            '<td>' + (ver.release_type || 'stable') + '</td>' +
            '<td>' + size + '</td>' +
            '<td>' + formatDate(ver.created_at) + '</td>' +
            '<td>' +
                '<span class="badge ' + (isRunning ? 'badge-danger' : isInstalled ? 'badge-success' : 'badge-warning') + '">' +
                    (isRunning ? '运行中' : isInstalled ? '已安装' : '未安装') +
                '</span>' +
            '</td>' +
            '<td>' +
                '<div class="d-flex gap-1">' +
                    '<button class="btn btn-sm btn-info" onclick="showVersionDetails(\'' + escapeHtml(ver.version) + '\')">详情</button>' +
                    (isInstalled ? '<button class="btn btn-sm btn-primary" onclick="switchVersion(\'' + escapeHtml(ver.version) + '\', ' + isRunning + ')">切换</button>' : '') +
                    (isInstalled && !isDefault ? '<button class="btn btn-sm btn-success" onclick="setDefaultVersion(\'' + escapeHtml(ver.version) + '\')">设为默认</button>' : '') +
                    (isInstalled ? '<button class="btn btn-sm btn-warning" onclick="verifyVersion(\'' + escapeHtml(ver.version) + '\')">验证</button>' : '') +
                    (isInstalled ? (!isRunning ? '<button class="btn btn-sm btn-danger" onclick="deleteVersion(\'' + escapeHtml(ver.version) + '\')">删除</button>' : '') : '') +
                '</div>' +
            '</td>' +
        '</tr>';
    }).join('');

    tbody.innerHTML = html;
}

async function switchVersion(version, isRunning) {
    if (isRunning) {
        showToast('该版本正在运行中，请先停止服务器或选择其他版本后再进行切换操作。', 'warning');
        return;
    }
    showModal({title:'确认切换',content:'确定要切换到版本 '+version+' 吗？',confirmText:'切换',onConfirm:async function(){
    try {
        var ver = versionListData.find(function(v) { return v.version === version; });
        if (!ver) {
            showToast('切换失败: 版本信息不完整', 'error');
            return;
        }
        var response = await fetchAPI('/api/versions/' + encodeURIComponent(version), { method: 'DELETE' });
        var result = await response.json();
        ApiResponse.handleResponse(result,
            function() {
                showToast('版本切换成功', 'success');
                loadVersionList();
            },
            function(error) {
                showToast('切换失败: ' + error, 'error');
            }
        );
    } catch (e) { showToast('切换失败: ' + e.message, 'error'); }
    }});

}

async function setDefaultVersion(version) {
    showModal({title:'确认设置',content:'确定要将版本 '+version+' 设为默认版本吗？',confirmText:'确认',onConfirm:async function(){
    try {
        var response = await fetchAPI('/api/versions/set-default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: version })
        });
        var result = await response.json();
        ApiResponse.handleResponse(result,
            function() {
                showToast('默认版本设置成功', 'success');
                loadCurrentVersion();
                loadVersionList();
            },
            function(error) {
                showToast('设置失败: ' + error, 'error');
            }
        );
    } catch (e) { showToast('设置失败: ' + e.message, 'error'); }
    }});

}

async function deleteVersion(version) {
    var ver = versionListData.find(function(v) { return v.version === version; });
    if (ver && ver.is_running) {
        showToast('该版本正在使用中，无法删除。请先停止服务器或切换到其他版本后再进行删除操作。', 'warning');
        return;
    }
    showModal({title:'确认删除',content:'确定要删除版本 '+version+' 吗？此操作不可逆，请确认！',confirmText:'删除',danger:true,onConfirm:async function(){
    try {
        if (!ver) {
            showToast('删除失败：版本信息不完整', 'error');
            return;
        }
        var response = await fetchAPI('/api/versions/' + encodeURIComponent(version), { method: 'DELETE' });
        var result = await response.json();
        ApiResponse.handleResponse(result,
            function() {
                showToast('版本删除成功', 'success');
                loadVersionList();
            },
            function(error) {
                showToast('删除失败：' + error, 'error');
            }
        );
    } catch (e) { showToast('删除失败：' + e.message, 'error'); }
    }});

}

function verifyVersion(version) {
    showToast('验证版本 ' + version + '...', 'info');
    fetchAPI('/api/versions/verify/' + encodeURIComponent(version))
        .then(function(response) { return response.json(); })
        .then(function(response) {
            ApiResponse.handleResponse(response,
                function() {
                    showToast('版本验证成功', 'success');
                },
                function(error) {
                    showToast('版本验证失败: ' + error, 'error');
                }
            );
        })
        .catch(function(error) {
            showToast('验证失败: ' + error.message, 'error');
        });
}

async function installVersion() {
    var version = document.getElementById('install-version-input').value.trim();
    var releaseType = 'stable';
    if (!version) {
        showToast('请输入要安装的版本号，例如：1.1.100', 'warning');
        return;
    }
    showModal({title:'确认安装',content:'确定要安装版本 '+version+' (稳定版) 吗？',confirmText:'安装',onConfirm:async function(){
        var installBtn = document.getElementById('install-btn');
        var progressContainer = document.getElementById('install-progress');
        var progressBar = document.getElementById('install-progress-bar');
        var progressText = document.getElementById('install-progress-text');

        installBtn.disabled = true;
        installBtn.textContent = '处理中...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '准备安装...';

        var progressPollInterval = setInterval(async function() {
            try {
                var response = await fetchAPI('/api/versions/progress?version=' + encodeURIComponent(version));
                var result = await response.json();
                if (ApiResponse.isSuccess(result)) {
                    var progressData = ApiResponse.getData(result);
                    progressBar.style.width = progressData.progress + '%';
                    progressText.textContent = progressData.status + ' ' + progressData.progress + '%';
                }
            } catch (e) {
                console.error('获取进度失败:', e);
            }
        }, 1000);

        try {
            var response = await fetchAPI('/api/versions/upgrade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_version: version, release_type: releaseType })
            });
            var result = await response.json();
            clearInterval(progressPollInterval);
            ApiResponse.handleResponse(result,
                function() {
                    progressBar.style.width = '100%';
                    progressText.textContent = '安装完成！';
                    setTimeout(function() {
                        progressContainer.style.display = 'none';
                        installBtn.disabled = false;
                        installBtn.textContent = '安装版本';
                        showToast('版本安装成功', 'success');
                        loadVersionList();
                        loadCurrentVersion();
                    }, 1000);
                },
                function(error) {
                    progressBar.style.width = '100%';
                    progressText.textContent = '安装失败';
                    setTimeout(function() {
                        progressContainer.style.display = 'none';
                        installBtn.disabled = false;
                        installBtn.textContent = '安装版本';
                        showToast('安装失败: ' + error, 'error');
                    }, 1500);
                }
            );
        } catch (e) {
            clearInterval(progressPollInterval);
            progressBar.style.width = '100%';
            progressText.textContent = '安装失败';
            setTimeout(function() {
                progressContainer.style.display = 'none';
                installBtn.disabled = false;
                installBtn.textContent = '安装版本';
                showToast('安装失败: ' + e.message, 'error');
            }, 1500);
        }
    }});
}

async function installVersionFromList(version) {
    if (!version) return;
    showModal({title:'确认安装',content:'确定要安装版本 '+version+' 吗？',confirmText:'安装',onConfirm:async function(){
        var installBtn = document.getElementById('install-btn');
        var progressContainer = document.getElementById('install-progress');
        var progressBar = document.getElementById('install-progress-bar');
        var progressText = document.getElementById('install-progress-text');

        installBtn.disabled = true;
        installBtn.textContent = '处理中...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '准备安装...';

        var progressPollInterval = setInterval(async function() {
            try {
                var response = await fetchAPI('/api/versions/progress?version=' + encodeURIComponent(version));
                var result = await response.json();
                if (ApiResponse.isSuccess(result)) {
                    var progressData = ApiResponse.getData(result);
                    progressBar.style.width = progressData.progress + '%';
                    progressText.textContent = progressData.status + ' ' + progressData.progress + '%';
                }
            } catch (e) {
                console.error('获取进度失败:', e);
            }
        }, 1000);

        try {
            document.getElementById('install-version-input').value = version;
            var response = await fetchAPI('/api/versions/upgrade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_version: version, release_type: 'stable' })
            });
            var result = await response.json();
            clearInterval(progressPollInterval);
            ApiResponse.handleResponse(result,
                function() {
                    progressBar.style.width = '100%';
                    progressText.textContent = '安装完成！';
                    setTimeout(function() {
                        progressContainer.style.display = 'none';
                        installBtn.disabled = false;
                        installBtn.textContent = '安装版本';
                        showToast('版本安装成功', 'success');
                        loadVersionList();
                        loadCurrentVersion();
                    }, 1000);
                },
                function(error) {
                    progressBar.style.width = '100%';
                    progressText.textContent = '安装失败';
                    setTimeout(function() {
                        progressContainer.style.display = 'none';
                        installBtn.disabled = false;
                        installBtn.textContent = '安装版本';
                        showToast('安装失败: ' + error, 'error');
                    }, 1500);
                }
            );
        } catch (e) {
            clearInterval(progressPollInterval);
            progressBar.style.width = '100%';
            progressText.textContent = '安装失败';
            setTimeout(function() {
                progressContainer.style.display = 'none';
                installBtn.disabled = false;
                installBtn.textContent = '安装版本';
                showToast('安装失败: ' + e.message, 'error');
            }, 1500);
        }
    }});

}

function showVersionDetails(version) {
    var ver = versionListData.find(function(v) { return v.version === version; });
    if (!ver) {
        showToast('版本信息不存在', 'error');
        return;
    }

    var message = '版本: ' + ver.version + '\n';
    message += '类型: ' + (ver.release_type || 'stable') + '\n';
    message += '大小: ' + (ver.size_bytes ? (ver.size_bytes / (1024 * 1024)).toFixed(2) + ' MB' : '未知') + '\n';
    message += '安装日期: ' + formatDate(ver.created_at) + '\n';
    message += '是否当前版本: ' + (ver.is_current ? '是' : '否') + '\n';
    message += '是否默认版本: ' + (ver.is_default ? '是' : '否');
    showToast(message, 'info');
}

function renderLatestVersion(versionInfo) {
    var container = document.getElementById('latest-version-info');

    if (versionInfo.error) {
        container.innerHTML =
            '<div class="text-center p-4">' +
                '<span class="badge badge-danger mb-2">检查更新失败</span>' +
                '<p>' + escapeHtml(versionInfo.changelog || '无法连接到 Factorio API，请检查网络连接后重试。') + '</p>' +
            '</div>';
        return;
    }

    if (!versionInfo.has_update) {
        container.innerHTML =
            '<div class="text-center p-4">' +
                '<span class="badge badge-success mb-2">已是最新版本</span>' +
                '<p>当前使用的已是最新可用版本，无需更新。</p>' +
            '</div>';
        return;
    }

    container.innerHTML =
        '<div class="version-update-grid">' +
            '<div class="version-card version-card-stable">' +
                '<div class="version-card-header">' +
                    '<span class="badge badge-success">稳定版</span>' +
                '</div>' +
                '<div class="version-card-body">' +
                    '<div class="version-number">' + (versionInfo.stable_version || '未知') + '</div>' +
                    '<button class="btn btn-primary btn-sm version-install-btn" onclick="installOrUpgradeVersion(\'' + escapeHtml(versionInfo.stable_version) + '\', \'stable\', \'' + '确定要安装稳定版 ' + versionInfo.stable_version + ' 吗？' + '\')">立即安装</button>' +
                '</div>' +
            '</div>' +
            '<div class="version-card version-card-experimental">' +
                '<div class="version-card-header">' +
                    '<span class="badge badge-warning">实验版</span>' +
                    '<span class="version-warning-tip">可能不稳定</span>' +
                '</div>' +
                '<div class="version-card-body">' +
                    '<div class="version-number">' + (versionInfo.experimental_version || '未知') + '</div>' +
                    '<button class="btn btn-warning btn-sm version-install-btn" onclick="installOrUpgradeVersion(\'' + escapeHtml(versionInfo.experimental_version) + '\', \'experimental\', \'确定要安装实验版 ' + versionInfo.experimental_version + ' 吗？实验版可能存在不稳定因素。\')">立即安装</button>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div id="latest-version-progress" style="display: none;" class="mt-4">' +
            '<div class="install-progress-bar-wrap">' +
                '<div class="install-progress-bar" id="latest-progress-bar" style="width: 0%;"></div>' +
            '</div>' +
            '<p class="mt-2 text-muted" id="latest-progress-text" style="font-size: var(--font-size-sm);">准备中...</p>' +
        '</div>';
}

function installOrUpgradeVersion(version, releaseType, confirmMessage) {
    showModal({title:'确认',content:confirmMessage,confirmText:'确认',onConfirm:function(){
        var buttons = document.querySelectorAll('button[onclick^="installOrUpgradeVersion"]');
        var progressContainer = document.getElementById('latest-version-progress');
        var progressBar = document.getElementById('latest-progress-bar');
        var progressText = document.getElementById('latest-progress-text');

        buttons.forEach(function(btn) {
            btn.disabled = true;
            btn.textContent = '处理中...';
        });
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '准备安装...';

        var progressPollInterval = setInterval(function() {
            try {
                fetchAPI('/api/versions/progress?version=' + encodeURIComponent(version))
                .then(function(response) { return response.json(); })
                .then(function(response) {
                    ApiResponse.handleResponse(response,
                        function(data) {
                            var progressData = data;
                            progressBar.style.width = progressData.progress + '%';
                            progressText.textContent = progressData.status + ' ' + progressData.progress + '%';
                        }
                    );
                })
                .catch(function(e) {
                    console.error('获取进度失败:', e);
                });
            } catch (e) {
                console.error('获取进度失败:', e);
            }
        }, 1000);

        fetchAPI('/api/versions/upgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_version: version, release_type: releaseType || 'stable' })
        })
            .then(function(response) { return response.json(); })
            .then(function(response) {
                clearInterval(progressPollInterval);
                ApiResponse.handleResponse(response,
                    function() {
                        progressBar.style.width = '100%';
                        progressText.textContent = '安装完成！';
                        setTimeout(function() {
                            progressContainer.style.display = 'none';
                            buttons.forEach(function(btn) {
                                btn.disabled = false;
                                btn.textContent = '立即安装';
                            });
                            showToast('安装完成！', 'success');
                            loadCurrentVersion();
                            loadVersionList();
                            checkVersionUpdate();
                        }, 1000);
                    },
                    function(error) {
                        progressBar.style.width = '100%';
                        progressText.textContent = '安装失败';
                        setTimeout(function() {
                            progressContainer.style.display = 'none';
                            buttons.forEach(function(btn) {
                                btn.disabled = false;
                                btn.textContent = '立即安装';
                            });
                            showToast('安装失败: ' + error, 'error');
                        }, 1500);
                    }
                );
            })
            .catch(function(error) {
                clearInterval(progressPollInterval);
                progressBar.style.width = '100%';
                progressText.textContent = '安装失败';
                setTimeout(function() {
                    progressContainer.style.display = 'none';
                    buttons.forEach(function(btn) {
                        btn.disabled = false;
                        btn.textContent = '立即安装';
                    });
                    showToast('安装失败: ' + error.message, 'error');
                }, 1500);
            });
    }});
}