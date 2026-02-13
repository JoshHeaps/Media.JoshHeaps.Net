// Theme Toggle Functionality
(function() {
    const THEME_KEY = 'theme-preference';
    const OVERRIDES_KEY = 'theme-overrides';

    // Initialize theme on page load
    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY);
        const theme = savedTheme || 'light'; // Default to light

        document.documentElement.setAttribute('data-theme', theme);
    }

    // Apply color overrides from localStorage
    function applyColorOverrides() {
        var raw = localStorage.getItem(OVERRIDES_KEY);
        if (!raw) return;
        try {
            var overrides = JSON.parse(raw);
            for (var key in overrides) {
                if (overrides.hasOwnProperty(key)) {
                    document.documentElement.style.setProperty(key, overrides[key]);
                }
            }
        } catch (e) {
            // Ignore malformed JSON
        }
    }

    // Clear all inline color overrides from documentElement
    function clearColorOverrides() {
        var raw = localStorage.getItem(OVERRIDES_KEY);
        if (!raw) return;
        try {
            var overrides = JSON.parse(raw);
            for (var key in overrides) {
                if (overrides.hasOwnProperty(key)) {
                    document.documentElement.style.removeProperty(key);
                }
            }
        } catch (e) {
            // Ignore
        }
    }

    // Toggle theme
    function toggleTheme() {
        var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        var newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(THEME_KEY, newTheme);

        // Re-apply overrides after theme switch (inline styles take precedence)
        applyColorOverrides();
    }

    // Initialize immediately (before DOMContentLoaded to prevent flash)
    initTheme();
    applyColorOverrides();

    // Set up toggle listener when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        var toggle = document.getElementById('theme-toggle');
        if (toggle) {
            // Sync checkbox state to current theme
            var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            toggle.checked = currentTheme === 'dark';

            toggle.addEventListener('change', toggleTheme);
        }
    });

    // Expose for theme customizer
    window._themeUtils = {
        applyColorOverrides: applyColorOverrides,
        clearColorOverrides: clearColorOverrides,
        THEME_KEY: THEME_KEY,
        OVERRIDES_KEY: OVERRIDES_KEY
    };
})();
