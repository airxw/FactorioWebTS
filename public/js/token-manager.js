(function(window) {
    'use strict';

    const TOKEN_STORAGE_KEY = 'session_token';
    const USER_INFO_KEY = 'user_info';
    const AUTH_HEADER_NAME = 'Authorization';
    const AUTH_HEADER_PREFIX = 'Bearer ';

    const TokenManager = {
        setToken: function(token) {
            if (!token) {
                this.removeToken();
                return;
            }
            localStorage.setItem(TOKEN_STORAGE_KEY, token);
        },

        getToken: function() {
            return localStorage.getItem(TOKEN_STORAGE_KEY);
        },

        removeToken: function() {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        },

        hasToken: function() {
            return !!this.getToken();
        },

        setUserInfo: function(userInfo) {
            if (!userInfo) {
                this.removeUserInfo();
                return;
            }
            localStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
        },

        getUserInfo: function() {
            const infoStr = localStorage.getItem(USER_INFO_KEY);
            if (!infoStr) {
                return null;
            }
            try {
                return JSON.parse(infoStr);
            } catch (e) {
                console.error('Failed to parse user info:', e);
                return null;
            }
        },

        removeUserInfo: function() {
            localStorage.removeItem(USER_INFO_KEY);
        },

        getAuthHeaders: function() {
            const token = this.getToken();
            if (!token) {
                return {};
            }
            return {
                [AUTH_HEADER_NAME]: AUTH_HEADER_PREFIX + token
            };
        },

        clear: function() {
            this.removeToken();
            this.removeUserInfo();
        }
    };

    window.TokenManager = TokenManager;

})(window);
