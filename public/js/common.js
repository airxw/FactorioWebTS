(function() {
  function getAuthHeaders(contentType) {
    var h = { 'Authorization': 'Bearer ' + TokenManager.getToken() };
    if (contentType) h['Content-Type'] = contentType;
    return h;
  }

  function createToastElement(msg, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast-item toast-' + type;
    toast.innerHTML = '<div class="toast-body"><div class="toast-message">' + escapeHtml(msg) + '</div></div><button class="toast-close">&times;</button>';
    container.appendChild(toast);
    var timer = setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3000);
    toast.querySelector('.toast-close').addEventListener('click', function() { clearTimeout(timer); toast.remove(); });
  }

  window.createPageApp = function(options) {
    options = options || {};
    var base = {
      logout: function() {
        TokenManager.clear();
        window.location.href = 'login.html';
      },

      apiGet: function(url) {
        return fetch(url, { headers: getAuthHeaders() })
          .then(function(res) {
            if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
            return res.json();
          });
      },

      apiPost: function(url, data) {
        return fetch(url, {
          method: 'POST',
          headers: getAuthHeaders('application/json'),
          body: JSON.stringify(data)
        })
        .then(function(res) {
          if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
          return res.json();
        });
      },

      apiDelete: function(url) {
        return fetch(url, {
          method: 'DELETE',
          headers: getAuthHeaders()
        })
        .then(function(res) {
          if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
          return res.json();
        });
      },

      getToken: function() {
        return TokenManager.getToken();
      },

      showToast: function(message, type) {
        createToastElement(message, type);
      },

      initSidebar: function() {
        SidebarMenu.initSidebarWithPermission();
      },

      themeToggle: function() {
        ThemeManager.toggle();
      },

      authHeaders: function(contentType) {
        return getAuthHeaders(contentType);
      }
    };
    var descriptors = Object.getOwnPropertyDescriptors(options);
    Object.defineProperties(base, descriptors);
    return base;
  };

  window.initCommonPage = function(appInstance) {
    SidebarMenu.initSidebarWithPermission();

    var mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    var sidebar = document.getElementById('sidebar');
    if (mobileMenuToggle && sidebar) {
      var overlay = document.getElementById('sidebar-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebar-overlay';
        document.body.appendChild(overlay);
      }

      function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      }

      mobileMenuToggle.addEventListener('click', function() {
        if (sidebar.classList.contains('open')) {
          closeSidebar();
        } else {
          sidebar.classList.add('open');
          overlay.classList.add('visible');
        }
      });

      overlay.addEventListener('click', function() {
        closeSidebar();
      });

      window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
          closeSidebar();
        }
      });
    }
  };
})();
