(function() {
    var shopItems = [];
    var cartItems = [];
    var vipInfo = null;
    var CART_KEY = 'shop_cart';
    var allItems = [];
    var currentPage = 1;
    var itemsPerPage = 20;
    var currentCategory = '';

    var QUALITY_NAMES = {
        1: '普通',
        2: '稀有',
        3: '史诗',
        4: '传说',
        5: '神话'
    };

    var QUALITY_MULTIPLIER = {
        1: 1,
        2: 1.5,
        3: 2,
        4: 3,
        5: 5
    };

    var CATEGORY_NAMES = {
        'combat': '战斗',
        'equipment': '装备',
        'intermediate': '中间品',
        'logistics': '物流',
        'other': '其他',
        'production': '生产',
        'space-age': '太空时代'
    };

    document.addEventListener('DOMContentLoaded', function() {
        checkSession({
            requireAuth: true,
            onValid: function(userData) {
                SidebarMenu.initSidebarWithPermission();

                loadCartFromStorage();
                loadShopItems();
                loadVipInfo();
                loadOrders();

                document.getElementById('order-status-filter').addEventListener('change', loadOrders);

                wsClient.on('order_result', function(data) {
                    loadOrders();
                });
            }
        });
    });

    function loadShopItems(category, page) {
        category = category !== undefined ? category : currentCategory;
        currentCategory = category;
        currentPage = page !== undefined ? page : 1;
        
        fetchAPI('/api/shop/items?category=' + encodeURIComponent(category || '')).then(function(res) { return res.json(); }).then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    var result = data;
                    allItems = result.items || [];

                    if (category === '' && result.categories) {
                        renderCategories(result.categories);
                    }

                    renderCurrentPageItems();
                    renderPagination();
                },
                function(error) {
                    showToast('加载商品列表失败: ' + error, 'error');
                    document.getElementById('item-grid').innerHTML = '<div class="text-center p-4">加载失败</div>';
                }
            );
        }).catch(function(error) {
            showToast('加载商品列表失败: ' + (error.message || '未知错误'), 'error');
            document.getElementById('item-grid').innerHTML = '<div class="text-center p-4">加载失败</div>';
        });
    }

    function renderCurrentPageItems() {
        var startIndex = (currentPage - 1) * itemsPerPage;
        var endIndex = startIndex + itemsPerPage;
        var pageItems = allItems.slice(startIndex, endIndex);
        renderItems(pageItems);
    }

    function renderPagination() {
        var totalPages = Math.ceil(allItems.length / itemsPerPage);
        var container = document.getElementById('pagination-container');
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        var html = '';
        
        html += '<button class="pagination-btn" onclick="goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>上一页</button>';
        
        html += '<span class="pagination-info">第 ' + currentPage + ' / ' + totalPages + ' 页 (共 ' + allItems.length + ' 件商品)</span>';
        
        html += '<button class="pagination-btn" onclick="goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>下一页</button>';
        
        container.innerHTML = html;
    }

    function goToPage(page) {
        var totalPages = Math.ceil(allItems.length / itemsPerPage);
        if (page < 1 || page > totalPages) {
            return;
        }
        currentPage = page;
        renderCurrentPageItems();
        renderPagination();
    }

    function renderCategories(categories) {
        var categoryList = document.querySelector('.category-list');
        categoryList.innerHTML = '<li><button class="w-100 btn btn-primary active" data-category="">全部</button></li>';

        categories.forEach(function(cat) {
            var catName = CATEGORY_NAMES[cat] || cat;
            var li = document.createElement('li');
            li.innerHTML = '<button class="w-100 btn" data-category="' + escapeHtml(cat) + '">' + escapeHtml(catName) + '</button>';
            categoryList.appendChild(li);
        });

        categoryList.querySelectorAll('button').forEach(function(btn) {
            btn.addEventListener('click', function() {
                categoryList.querySelectorAll('button').forEach(function(b) {
                    b.classList.remove('active', 'btn-primary');
                });
                this.classList.add('active', 'btn-primary');
                loadShopItems(this.dataset.category);
            });
        });
    }

    function renderItems(items) {
        var grid = document.getElementById('item-grid');

        if (items.length === 0) {
            grid.innerHTML = '<div class="text-center p-4">暂无商品</div>';
            return;
        }

        grid.innerHTML = items.map(function(item) {
            var categoryName = CATEGORY_NAMES[item.category] || item.category;

            return '<div class="item-card">' +
                '<div class="item-card-header">' +
                    '<div class="item-name">' + escapeHtml(item.name) + '</div>' +
                    '<div class="item-meta">' + escapeHtml(categoryName) + '</div>' +
                '</div>' +
                '<div class="item-code">' + escapeHtml(item.code) + '</div>' +
                '<button class="btn btn-sm btn-primary btn-add-cart" onclick="addToCart(' + item.id + ')">加入购物车</button>' +
            '</div>';
        }).join('');
    }

    function loadVipInfo() {
        var userId = getUserId();
        if (!userId) {
            renderVipInfo(null);
            return;
        }

        fetchAPI('/api/vip/levels').then(function(res) { return res.json(); }).then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    var info = data;
                    vipInfo = {
                        vip_level: info.vip_level || 0,
                        vip_level_name: info.vip_level_name || '普通会员',
                        is_expired: info.is_expired || false,
                        daily_limit: info.daily_limit || info.daily_purchase_limit || 5,
                        single_limit: info.single_limit || info.single_purchase_limit || 10,
                        max_quality: info.max_quality || info.max_quality_level || 1
                    };
                    if (vipInfo.vip_level === 0 || vipInfo.is_expired) {
                        vipInfo.max_quality = 1;
                    }
                    renderVipInfo(vipInfo);
                    renderCart();
                },
                function(error) {
                    vipInfo = { vip_level: 0, vip_level_name: '普通会员', is_expired: false, daily_limit: 5, single_limit: 10, max_quality: 1 };
                    renderVipInfo(vipInfo);
                }
            );
        })
        .catch(function(error) {
            showToast('加载VIP信息失败', 'error');
            vipInfo = { vip_level: 0, vip_level_name: '普通会员', is_expired: false, daily_limit: 5, single_limit: 10, max_quality: 1 };
            renderVipInfo(vipInfo);
        });
    }

    function renderVipInfo(info) {
        var container = document.getElementById('vip-info-container');

        if (!info) {
            container.innerHTML = '<div class="vip-info-row"><span class="vip-info-label">VIP等级</span><span class="vip-info-value">未登录</span></div>';
            return;
        }

        container.innerHTML =
            '<div class="vip-info-row"><span class="vip-info-label">VIP等级</span><span class="vip-info-value">' + escapeHtml(info.vip_level_name) + ' (Lv.' + info.vip_level + ')</span></div>' +
            '<div class="vip-info-row"><span class="vip-info-label">每日限购次数</span><span class="vip-info-value">' + (info.daily_limit === -1 ? '无限' : info.daily_limit + ' 次') + '</span></div>' +
            '<div class="vip-info-row"><span class="vip-info-label">单次限购数量</span><span class="vip-info-value">' + (info.single_limit === -1 ? '无限' : info.single_limit + ' 个') + '</span></div>' +
            '<div class="vip-info-row"><span class="vip-info-label">最高品质</span><span class="vip-info-value"><span class="quality-badge quality-badge-' + info.max_quality + '">' + QUALITY_NAMES[info.max_quality] + '</span></span></div>' +
            (info.is_expired ? '<div class="vip-info-row"><span class="vip-info-label text-danger">VIP状态</span><span class="vip-info-value text-danger">已过期</span></div>' : '');
    }

    function getUserId() {
        try {
            var userInfo = localStorage.getItem('user_info');
            if (userInfo) {
                var parsed = JSON.parse(userInfo);
                return parsed.id || parsed.user_id || null;
            }
        } catch (e) {}
        return null;
    }

    function addToCart(itemId) {
        var item = allItems.find(function(i) { return i.id === itemId; });
        if (!item) return;

        var existing = cartItems.find(function(c) { return c.id === itemId; });
        if (existing) {
            existing.quantity += 1;
        } else {
            var maxQ = vipInfo ? vipInfo.max_quality : 1;
            var defaultQuality = Math.min(item.quality_level || 1, maxQ);
            if (defaultQuality < 1) defaultQuality = 1;
            cartItems.push({
                id: item.id,
                name: item.name,
                code: item.code,
                price: item.price,
                quantity: 1,
                quality: defaultQuality,
                stock: item.stock
            });
        }

        saveCartToStorage();
        renderCart();
    }

    function removeFromCart(itemId) {
        cartItems = cartItems.filter(function(c) { return c.id !== itemId; });
        saveCartToStorage();
        renderCart();
    }

    function updateCartQuantity(itemId, delta) {
        var item = cartItems.find(function(c) { return c.id === itemId; });
        if (!item) return;

        var newQty = item.quantity + delta;
        if (newQty < 1) {
            removeFromCart(itemId);
            return;
        }

        var singleLimit = vipInfo ? vipInfo.single_limit : 10;
        if (singleLimit !== -1 && newQty > singleLimit) {
            showToast('单次限购数量不能超过 ' + singleLimit + ' 个', 'warning');
            return;
        }

        item.quantity = newQty;
        saveCartToStorage();
        renderCart();
    }

    function updateCartQuality(itemId, quality) {
        var item = cartItems.find(function(c) { return c.id === itemId; });
        if (!item) return;

        quality = parseInt(quality);
        var maxQ = vipInfo ? vipInfo.max_quality : 1;
        if (quality > maxQ) {
            showToast('您的VIP等级最多只能购买 ' + maxQ + ' (' + QUALITY_NAMES[maxQ] + ') 品质的物品', 'warning');
            quality = maxQ;
        }

        item.quality = quality;
        saveCartToStorage();
        renderCart();
    }

    function clearCart() {
        showModal({ title: '清空购物车', content: '确定要清空购物车吗？', confirmText: '确认', danger: true, onConfirm: function() {
            cartItems = [];
            saveCartToStorage();
            renderCart();
        }});
    }

    function saveCartToStorage() {
        localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    }

    function loadCartFromStorage() {
        try {
            var saved = localStorage.getItem(CART_KEY);
            if (saved) {
                cartItems = JSON.parse(saved);
                if (!Array.isArray(cartItems)) cartItems = [];
            }
        } catch (e) {
            cartItems = [];
        }
        renderCart();
    }

    function calculateItemTotal(item) {
        var multiplier = QUALITY_MULTIPLIER[item.quality] || 1;
        return item.price * item.quantity * multiplier;
    }

    function calculateCartTotal() {
        return cartItems.reduce(function(sum, item) {
            return sum + calculateItemTotal(item);
        }, 0);
    }

    function renderCart() {
        var container = document.getElementById('cart-container');
        var footer = document.getElementById('cart-footer');
        var clearBtn = document.getElementById('btn-clear-cart');

        if (cartItems.length === 0) {
            container.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><div>购物车是空的</div></div>';
            footer.style.display = 'none';
            clearBtn.style.display = 'none';
            return;
        }

        footer.style.display = 'block';
        clearBtn.style.display = 'inline-block';

        var maxQ = vipInfo ? vipInfo.max_quality : 1;

        container.innerHTML = cartItems.map(function(item) {
            var qualityOptions = '';
            for (var q = 1; q <= 5; q++) {
                var disabled = q > maxQ ? ' disabled' : '';
                var selected = q === item.quality ? ' selected' : '';
                qualityOptions += '<option value="' + q + '"' + selected + disabled + '>' + QUALITY_NAMES[q] + '</option>';
            }

            return '<div class="cart-item">' +
                '<div class="cart-item-header">' +
                    '<span class="cart-item-name">' + escapeHtml(item.name) + '</span>' +
                '</div>' +
                '<div class="cart-item-controls">' +
                    '<button class="qty-btn" onclick="updateCartQuantity(' + item.id + ', -1)">-</button>' +
                    '<span class="qty-value">' + item.quantity + '</span>' +
                    '<button class="qty-btn" onclick="updateCartQuantity(' + item.id + ', 1)">+</button>' +
                    '<select onchange="updateCartQuality(' + item.id + ', this.value)">' + qualityOptions + '</select>' +
                    '<button class="btn btn-sm btn-danger btn-remove" onclick="removeFromCart(' + item.id + ')">移除</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function openCheckout() {
        if (cartItems.length === 0) {
            showToast('购物车是空的', 'warning');
            return;
        }

        var summaryHtml = '<div class="mb-2 fw-bold">订单详情</div>';
        cartItems.forEach(function(item) {
            summaryHtml += '<div class="checkout-summary-item">' +
                '<span>' + escapeHtml(item.name) + ' x' + item.quantity + ' (' + QUALITY_NAMES[item.quality] + ')</span>' +
            '</div>';
        });

        document.getElementById('checkout-summary').innerHTML = summaryHtml;
        document.getElementById('checkout-error').style.display = 'none';

        document.querySelector('input[name="delivery-mode"][value="direct"]').checked = true;
        
        var playerNameInput = document.getElementById('checkout-player-name');
        var savedPlayerName = localStorage.getItem('shop_player_name');
        if (savedPlayerName) {
            playerNameInput.value = savedPlayerName;
        }

        updateDeliveryMode();

        document.getElementById('checkout-modal').classList.add('show');
    }

    function closeCheckout() {
        document.getElementById('checkout-modal').classList.remove('show');
    }

    function updateDeliveryMode() {
        var deliveryMode = document.querySelector('input[name="delivery-mode"]:checked').value;
        var playerNameGroup = document.getElementById('player-name-group');
        
        if (deliveryMode === 'direct') {
            playerNameGroup.style.display = 'block';
        } else {
            playerNameGroup.style.display = 'none';
        }
    }

    function submitCheckout() {
        var errorDiv = document.getElementById('checkout-error');
        errorDiv.style.display = 'none';

        var deliveryMode = document.querySelector('input[name="delivery-mode"]:checked').value;
        var playerName = document.getElementById('checkout-player-name').value.trim();
        
        if (deliveryMode === 'direct' && !playerName) {
            errorDiv.textContent = '请输入游戏角色名';
            errorDiv.style.display = 'block';
            return;
        }

        if (!vipInfo) {
            errorDiv.textContent = 'VIP信息未加载，请稍候重试';
            errorDiv.style.display = 'block';
            return;
        }

        for (var i = 0; i < cartItems.length; i++) {
            var item = cartItems[i];
            if (item.quality > vipInfo.max_quality) {
                errorDiv.textContent = item.name + ' 的品质超过您的VIP等级限制，最多只能购买 ' + QUALITY_NAMES[vipInfo.max_quality] + ' 品质';
                errorDiv.style.display = 'block';
                return;
            }
            if (vipInfo.single_limit !== -1 && item.quantity > vipInfo.single_limit) {
                errorDiv.textContent = item.name + ' 的数量超过单次限购限制，最多只能购买 ' + vipInfo.single_limit + ' 个';
                errorDiv.style.display = 'block';
                return;
            }
        }

        if (deliveryMode === 'direct' && playerName) {
            localStorage.setItem('shop_player_name', playerName);
        }

        var submitBtn = document.getElementById('btn-submit-checkout');
        submitBtn.disabled = true;
        submitBtn.textContent = '处理中...';

        var itemsJson = JSON.stringify(cartItems.map(function(item) {
            return {
                item_id: item.id,
                quantity: item.quantity,
                quality_level: item.quality
            };
        }));

        var params = {
            items: itemsJson
        };
        if (playerName) {
            params.player_name = playerName;
        }

        fetchAPI('/api/shop/orders/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) }).then(function(res) { return res.json(); }).then(function(d) {
            submitBtn.disabled = false;
            submitBtn.textContent = '提交订单';
            closeCheckout();

            var allSuccess = ApiResponse.isSuccess(d);
            var orderResults = [];
            var orderNumbers = [];
            var primaryOrderNumber = null;

            if (allSuccess && d.data && d.data.orders) {
                orderNumbers = d.data.order_numbers || [];
                primaryOrderNumber = d.data.primary_order_number || orderNumbers[0];
                orderResults = d.data.orders.map(function(order) {
                    return {
                        item: {
                            name: order.item_name,
                            quantity: order.quantity,
                            quality: order.quality_level || 1
                        },
                        success: true,
                        data: order,
                        message: '订单创建成功'
                    };
                });
                cartItems = [];
                saveCartToStorage();
                renderCart();
                loadOrders();
            } else {
                orderResults = cartItems.map(function(item) {
                    return {
                        item: item,
                        success: false,
                        message: ApiResponse.getError(d)
                    };
                });
            }

            showResultModal(allSuccess, orderResults, [primaryOrderNumber], deliveryMode);
        }).catch(function(error) {
            console.error('API Error:', error);
            submitBtn.disabled = false;
            submitBtn.textContent = '提交订单';
            closeCheckout();

            var orderResults = cartItems.map(function(item) {
                return {
                    item: item,
                    success: false,
                    message: '网络错误'
                };
            });

            showResultModal(false, orderResults, [], deliveryMode);
        });
    }

    function showResultModal(allSuccess, orderResults, orderNumbers, deliveryMode) {
        var title = allSuccess ? '订单成功' : '订单结果';
        document.getElementById('result-modal-title').textContent = title;

        var body = '';

        if (allSuccess && orderNumbers && orderNumbers.length > 0 && orderNumbers[0]) {
            var hintText = deliveryMode === 'direct' 
                ? '物品将会直接发送到您的游戏角色中'
                : '请在游戏中输入 /claim 订单号 来领取物品';

            body += '<div class="extraction-code">' +
                '<div class="code-label">订单号</div>' +
                '<div class="code-value code-value-lg">' + escapeHtml(orderNumbers[0]) + '</div>' +
                '<div class="code-hint">' + escapeHtml(hintText) + '</div>' +
            '</div>';
        }

        if (orderResults && orderResults.length > 0) {
            body += '<div class="mt-3">';
        orderResults.forEach(function(result) {
            var icon = result.success ? '✓' : '✗';
            var itemText = escapeHtml(result.item.name);
            if (result.item.quantity) {
                itemText += ' x' + result.item.quantity;
            }
            if (result.item.quality) {
                itemText += ' (' + QUALITY_NAMES[result.item.quality] + ')';
            }
            body += '<div class="checkout-summary-row">' +
                '<span>' + icon + ' ' + itemText + '</span>' +
            '</div>';
            if (!result.success) {
                body += '<div class="checkout-error-detail">' + escapeHtml(result.message || '订单失败') + '</div>';
            }
        });
        body += '</div>';
        }

        if (allSuccess) {
            body += '<div class="mt-4 text-center">' +
                '<button class="btn btn-primary" onclick="closeResultModal()">完成</button>' +
            '</div>';
        } else {
            body += '<div class="mt-4 text-center">' +
                '<button class="btn btn-secondary" onclick="closeResultModal()">关闭</button>' +
            '</div>';
        }

        document.getElementById('result-modal-body').innerHTML = body;
        document.getElementById('result-modal').classList.add('show');
    }

    function closeResultModal() {
        document.getElementById('result-modal').classList.remove('show');
    }

    function loadOrders() {
        var status = document.getElementById('order-status-filter').value;

        fetchAPI('/api/shop/orders/my?status=' + encodeURIComponent(status || 'all')).then(function(res) { return res.json(); }).then(function(response) {
            ApiResponse.handleResponse(response,
                function(data) {
                    var orders = data.orders || data;
                    renderOrders(Array.isArray(orders) ? orders : []);
                },
                function(error) {
                    showToast('加载订单列表失败: ' + error, 'error');
                    document.getElementById('orders-tbody').innerHTML = '<tr><td colspan="9" class="text-center">加载失败</td></tr>';
                }
            );
        })
        .catch(function(error) {
            showToast('加载订单列表失败', 'error');
            document.getElementById('orders-tbody').innerHTML = '<tr><td colspan="9" class="text-center">加载失败</td></tr>';
        });
    }

    function renderOrders(orders) {
        var tbody = document.getElementById('orders-tbody');

        if (!orders || orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">暂无订单</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(function(order) {
            var quality = order.quality_level || 1;
            var qualityBadge = '<span class="quality-badge quality-badge-' + quality + '">' + QUALITY_NAMES[quality] + '</span>';
            return '<tr>' +
                '<td><span class="badge badge-info">' + escapeHtml(order.order_number) + '</span></td>' +
                '<td>' + escapeHtml(order.item_name || '未知商品') + '</td>' +
                '<td>' + order.quantity + '</td>' +
                '<td>' + qualityBadge + '</td>' +
                '<td>' + escapeHtml(order.player_name) + '</td>' +
                '<td>$' + (order.total_price || '-') + '</td>' +
                '<td><span class="badge ' + getStatusBadgeClass(order.status) + '">' + getStatusText(order.status) + '</span></td>' +
                '<td>' + formatDate(order.created_at) + '</td>' +
                '<td>' +
                    (order.status === 'pending' ? '<button class="btn btn-sm btn-danger" onclick="cancelOrder(' + order.order_id + ')">取消</button>' : '') +
                '</td>' +
            '</tr>';
        }).join('');
    }

    function getStatusBadgeClass(status) {
        var map = {
            'pending': 'badge-warning',
            'processing': 'badge-info',
            'delivered': 'badge-success',
            'cancelled': 'badge-danger',
            'failed': 'badge-danger'
        };
        return map[status] || 'badge-info';
    }

    function getStatusText(status) {
        var map = {
            'pending': '待处理',
            'processing': '处理中',
            'delivered': '已发货',
            'cancelled': '已取消',
            'failed': '失败'
        };
        return map[status] || status;
    }

    function formatDate(timestamp) {
        if (!timestamp) return '-';
        var date = new Date(timestamp * 1000);
        return date.toLocaleString('zh-CN');
    }

    function cancelOrder(orderId) {
        showModal({ title: '取消订单', content: '确定要取消这个订单吗？', confirmText: '确认', danger: true, onConfirm: function() {
            fetchAPI('/api/shop/orders/' + orderId + '/cancel', { method: 'POST' }).then(function(res) { return res.json(); }).then(function(d) {
                if (ApiResponse.isSuccess(d)) {
                    showToast('订单已取消', 'success');
                    loadOrders();
                } else {
                    showToast('取消失败: ' + ApiResponse.getError(d), 'error');
                }
            }).catch(function(error) {
                showToast('取消失败: ' + (error.message || '未知错误'), 'error');
            });
        }});
    }

    function validateOrder() {
        var orderNo = document.getElementById('validate-order-no').value.trim();
        var resultDiv = document.getElementById('validate-result');

        if (!orderNo) {
            showToast('请输入订单号', 'warning');
            return;
        }

        fetchAPI('/api/shop/orders/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number: orderNo }) }).then(function(res) { return res.json(); }).then(function(d) {
            resultDiv.style.display = 'block';

            if (ApiResponse.isSuccess(d)) {
                var order = ApiResponse.getData(d);
                var quality = order.quality_level || 1;
                var qualityBadge = '<span class="quality-badge quality-badge-' + quality + '">' + QUALITY_NAMES[quality] + '</span>';

                resultDiv.innerHTML =
                    '<div class="card card-border-primary">' +
                        '<div class="card-body">' +
                            '<h4 class="mb-3 text-primary">订单验证成功</h4>' +
                            '<div class="form-row"><strong>订单号:</strong><span>' + escapeHtml(order.order_number || orderNo) + '</span></div>' +
                            '<div class="form-row"><strong>订单状态:</strong><span class="badge ' + getStatusBadgeClass(order.status) + '">' + getStatusText(order.status) + '</span></div>' +
                            '<div class="form-row"><strong>商品名称:</strong><span>' + escapeHtml(order.item_name || '未知商品') + '</span></div>' +
                            '<div class="form-row"><strong>购买数量:</strong><span>' + (order.quantity || '-') + '</span></div>' +
                            '<div class="form-row"><strong>品质等级:</strong><span>' + qualityBadge + '</span></div>' +
                            '<div class="form-row"><strong>总价:</strong><span>$' + (order.total_price || '-') + '</span></div>' +
                            '<div class="form-row"><strong>玩家名:</strong><span>' + escapeHtml(order.player_name || '-') + '</span></div>' +
                            '<div class="form-row"><strong>创建时间:</strong><span>' + (order.created_at ? formatDate(order.created_at) : '-') + '</span></div>' +
                        '</div>' +
                    '</div>';
            } else {
                resultDiv.innerHTML =
                    '<div class="card card-border-danger">' +
                        '<div class="card-body">' +
                            '<h4 class="text-danger">验证失败</h4>' +
                            '<p>' + escapeHtml(ApiResponse.getError(d)) + '</p>' +
                        '</div>' +
                    '</div>';
            }
        })
        .catch(function(error) {
            showToast('验证订单时出错', 'error');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML =
                '<div class="card card-border-danger">' +
                    '<div class="card-body">' +
                        '<h4 class="text-danger">验证失败</h4>' +
                        '<p>网络错误，请重试</p>' +
                    '</div>' +
                '</div>';
        });
    }

    function deliverOrder(orderNumber) {
        var orderNo = document.getElementById('validate-order-no').value.trim();
        showModal({ title: '发货确认', content: '确定要为订单 ' + orderNo + ' 发货吗？', confirmText: '确认', danger: true, onConfirm: function() {
            fetchAPI('/api/shop/orders/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number: orderNo, deliver: '1' }) }).then(function(res) { return res.json(); }).then(function(d) {
                ApiResponse.handleResponse(d,
                    function() {
                        showToast('订单已发货', 'success');
                        loadOrders();
                    },
                    function(error) {
                        showToast('发货失败: ' + error, 'error');
                    }
                );
            }).catch(function(e) {
                showToast('发货失败: ' + (e.message || '未知错误'), 'error');
            });
        }});
    }

    window.loadShopItems = loadShopItems;
    window.goToPage = goToPage;
    window.addToCart = addToCart;
    window.removeFromCart = removeFromCart;
    window.updateCartQuantity = updateCartQuantity;
    window.updateCartQuality = updateCartQuality;
    window.clearCart = clearCart;
    window.openCheckout = openCheckout;
    window.closeCheckout = closeCheckout;
    window.updateDeliveryMode = updateDeliveryMode;
    window.submitCheckout = submitCheckout;
    window.closeResultModal = closeResultModal;
    window.loadOrders = loadOrders;
    window.cancelOrder = cancelOrder;
    window.validateOrder = validateOrder;
    window.deliverOrder = deliverOrder;
})();