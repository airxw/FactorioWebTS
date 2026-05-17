(function() {
  var THEME_KEY = 'factorio_theme';

  window.ThemeManager = {
    init: function() {
      var saved = localStorage.getItem(THEME_KEY);
      if (!saved) {
        var oldTheme = localStorage.getItem('theme');
        if (oldTheme === 'dark') {
          localStorage.setItem(THEME_KEY, 'dark');
          localStorage.removeItem('theme');
          saved = 'dark';
        }
      }
      if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    },
    toggle: function() {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? '' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(THEME_KEY, next);
    }
  };

  window.toggleTheme = function() {
    ThemeManager.toggle();
  };

  ThemeManager.init();
})();
