class WebSocketClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxBackoffDelay = 60000;
        this.reconnectTimer = null;
        this.listeners = {};
        this.channelListeners = {};
        this.onReconnectCallback = null;
    }

    getReconnectDelay() {
        const baseDelay = 1000;
        const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), this.maxBackoffDelay);
        const jitter = Math.random() * 0.3 * delay;
        return Math.floor(delay + jitter);
    }

    onReconnect(callback) {
        this.onReconnectCallback = callback;
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        if (!callback) {
            this.listeners[event] = [];
            return;
        }
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    subscribe(channel, callback) {
        if (!this.channelListeners[channel]) {
            this.channelListeners[channel] = [];
        }
        this.channelListeners[channel].push(callback);
        if (this.connected) {
            this.send({ type: 'subscribe', channels: [channel] });
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(`Event handler error [${event}]:`, e); }
            });
        }
        if (this.channelListeners[event]) {
            this.channelListeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(`Channel handler error [${event}]:`, e); }
            });
        }
    }

    connect() {
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
            return;
        }

        try {
            this.socket = new WebSocket(this.wsUrl);
        } catch (e) {
            console.error('WebSocket creation failed:', e);
            this.attemptReconnect();
            return;
        }

        this.socket.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            const wasReconnect = this.reconnectAttempts > 0;
            this.reconnectAttempts = 0;
            this.sendAuth();
            this.resubscribeChannels();
            this.emit('open');

            if (wasReconnect && this.onReconnectCallback) {
                this.onReconnectCallback();
            }
        };

        this.socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
                return;
            }

            const eventType = data.type || data.event;
            if (eventType === 'auth_failed') {
                if (typeof handleUnauthorized === 'function') {
                    handleUnauthorized();
                }
                this.close();
                return;
            }

            this.emit('message', data);

            if (data.type) {
                this.emit(data.type, data);
            }

            if (data.channel) {
                this.emit(data.channel, data.data || data);
            }
        };

        this.socket.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            this.connected = false;
            this.emit('close', { code: event.code, reason: event.reason });
            if (event.code !== 1000) {
                this.attemptReconnect();
            }
        };

        this.socket.onerror = (error) => {
            if (this.reconnectAttempts <= 3) {
                console.error('WebSocket error:', error);
            }
            this.emit('error', error);
        };
    }

    sendAuth() {
        // 认证在连接时通过 URL query token 参数完成，无需额外发送
    }

    resubscribeChannels() {
        const channels = Object.keys(this.channelListeners);
        if (channels.length > 0) {
            this.send({ type: 'subscribe', channels: channels });
        }
    }

    attemptReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (!isFinite(this.reconnectAttempts) || this.reconnectAttempts >= 100) {
            return;
        }

        this.reconnectAttempts++;

        const delay = this.getReconnectDelay();
        console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);

        this.emit('reconnecting', { attempt: this.reconnectAttempts, delay: delay });

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    send(data) {
        if (this.connected && this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
        } else {
            console.warn('WebSocket is not connected. Message not sent:', data);
        }
    }

    close() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = Infinity;
        if (this.socket) {
            this.socket.close(1000, 'Client closed');
            this.socket = null;
        }
        this.connected = false;
    }
}

function deriveWsUrl() {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPortMeta = document.querySelector('meta[name="ws-port"]');
    let baseUrl;
    if (wsPortMeta && wsPortMeta.content) {
        baseUrl = `${protocol}//${loc.hostname}:${wsPortMeta.content}`;
    } else {
        baseUrl = `${protocol}//${loc.host}`;
    }
    const token = TokenManager.getToken();
    if (token) {
        return `${baseUrl}/ws?token=${encodeURIComponent(token)}`;
    }
    return `${baseUrl}/ws`;
}

const wsClient = new WebSocketClient(deriveWsUrl());
