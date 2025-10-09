// Theme Toggle Functionality
(function() {
    const THEME_KEY = 'theme-preference';

    // Initialize theme on page load
    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY);
        const theme = savedTheme || 'light'; // Default to light

        document.documentElement.setAttribute('data-theme', theme);

        // Update toggle if it exists
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.checked = theme === 'dark';
        }
    }

    // Toggle theme
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(THEME_KEY, newTheme);
    }

    // Initialize immediately (before DOMContentLoaded to prevent flash)
    initTheme();

    // Set up toggle listener when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.addEventListener('change', toggleTheme);
        }
    });
})();
