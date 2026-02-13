// Theme Customizer - Color picker modal with live iframe preview
(function() {
    var COLOR_VARIABLES = [
        { group: 'Background', vars: [
            { key: '--bg-primary', name: 'Primary Background' },
            { key: '--bg-secondary', name: 'Secondary Background' },
            { key: '--bg-tertiary', name: 'Tertiary Background' },
            { key: '--bg-hover', name: 'Hover Background' }
        ]},
        { group: 'Text', vars: [
            { key: '--text-primary', name: 'Primary Text' },
            { key: '--text-secondary', name: 'Secondary Text' }
        ]},
        { group: 'Border', vars: [
            { key: '--border-primary', name: 'Primary Border' },
            { key: '--border-secondary', name: 'Secondary Border' }
        ]},
        { group: 'Accent', vars: [
            { key: '--accent-primary', name: 'Primary Accent' },
            { key: '--accent-hover', name: 'Accent Hover' }
        ]},
        { group: 'Status', vars: [
            { key: '--danger', name: 'Danger' },
            { key: '--danger-hover', name: 'Danger Hover' },
            { key: '--success', name: 'Success' }
        ]}
    ];

    var allVarKeys = [];
    COLOR_VARIABLES.forEach(function(g) {
        g.vars.forEach(function(v) { allVarKeys.push(v.key); });
    });

    var pendingOverrides = {};
    var savedOverrides = {};
    var modal = null;
    var iframe = null;

    function getBaseTheme() {
        return document.documentElement.getAttribute('data-theme') || 'light';
    }

    function getComputedColor(varName) {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    function getCurrentColor(varName) {
        if (pendingOverrides[varName]) return pendingOverrides[varName];
        // Get the base theme value (not the overridden inline value)
        return getResolvedBaseColor(varName);
    }

    function getResolvedBaseColor(varName) {
        // To get the real CSS variable value without inline overrides,
        // we temporarily remove the inline style, read computed, then restore
        var inline = document.documentElement.style.getPropertyValue(varName);
        if (inline) {
            document.documentElement.style.removeProperty(varName);
            var val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            document.documentElement.style.setProperty(varName, inline);
            return val;
        }
        return getComputedColor(varName);
    }

    function rgbToHex(rgb) {
        if (!rgb || rgb.charAt(0) === '#') return rgb;
        var match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) return rgb;
        return '#' + [match[1], match[2], match[3]].map(function(x) {
            return parseInt(x).toString(16).padStart(2, '0');
        }).join('');
    }

    function buildModal() {
        var overlay = document.createElement('div');
        overlay.id = 'theme-customizer-overlay';

        var container = document.createElement('div');
        container.id = 'theme-customizer-modal';

        // Header
        var header = document.createElement('div');
        header.className = 'tc-header';
        header.innerHTML = '<h3>Customize Colors</h3>';
        var closeBtn = document.createElement('button');
        closeBtn.className = 'tc-close-btn';
        closeBtn.textContent = '\u00D7';
        closeBtn.onclick = cancelCustomizer;
        header.appendChild(closeBtn);
        container.appendChild(header);

        // Controls area
        var controls = document.createElement('div');
        controls.className = 'tc-controls';

        // Base theme selector
        var themeRow = document.createElement('div');
        themeRow.className = 'tc-row';
        themeRow.innerHTML = '<label>Base Theme:</label>';
        var themeSelect = document.createElement('select');
        themeSelect.id = 'tc-base-theme';
        themeSelect.innerHTML = '<option value="light">Light</option><option value="dark">Dark</option>';
        themeSelect.value = getBaseTheme();
        themeSelect.onchange = function() {
            document.documentElement.setAttribute('data-theme', themeSelect.value);
            localStorage.setItem(window._themeUtils.THEME_KEY, themeSelect.value);
            var toggle = document.getElementById('theme-toggle');
            if (toggle) toggle.checked = themeSelect.value === 'dark';
            // Re-apply pending overrides to parent
            applyPendingToDocument();
            updatePickerForSelection();
            updateSwatches();
            applyToIframe();
        };
        themeRow.appendChild(themeSelect);
        controls.appendChild(themeRow);

        // Color variable selector
        var varRow = document.createElement('div');
        varRow.className = 'tc-row';
        varRow.innerHTML = '<label>Color Variable:</label>';
        var varSelect = document.createElement('select');
        varSelect.id = 'tc-var-select';
        COLOR_VARIABLES.forEach(function(group) {
            var optgroup = document.createElement('optgroup');
            optgroup.label = group.group;
            group.vars.forEach(function(v) {
                var opt = document.createElement('option');
                opt.value = v.key;
                opt.textContent = v.name;
                optgroup.appendChild(opt);
            });
            varSelect.appendChild(optgroup);
        });
        varSelect.onchange = function() { updatePickerForSelection(); };
        varRow.appendChild(varSelect);
        controls.appendChild(varRow);

        // Color picker row
        var pickerRow = document.createElement('div');
        pickerRow.className = 'tc-row tc-picker-row';
        var colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = 'tc-color-picker';
        var hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.id = 'tc-hex-input';
        hexInput.placeholder = '#000000';
        hexInput.maxLength = 7;
        var removeBtn = document.createElement('button');
        removeBtn.id = 'tc-remove-override';
        removeBtn.className = 'tc-btn tc-btn-small';
        removeBtn.textContent = 'Reset';
        removeBtn.title = 'Remove override for this variable';
        removeBtn.onclick = function() {
            var key = varSelect.value;
            delete pendingOverrides[key];
            applyPendingToDocument();
            updatePickerForSelection();
            updateSwatches();
            applyToIframe();
        };

        colorInput.addEventListener('input', function() {
            var key = varSelect.value;
            pendingOverrides[key] = colorInput.value;
            hexInput.value = colorInput.value;
            applyPendingToDocument();
            updateSwatches();
            applyToIframe();
        });
        hexInput.addEventListener('input', function() {
            var val = hexInput.value;
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                var key = varSelect.value;
                pendingOverrides[key] = val;
                colorInput.value = val;
                applyPendingToDocument();
                updateSwatches();
                applyToIframe();
            }
        });

        pickerRow.appendChild(colorInput);
        pickerRow.appendChild(hexInput);
        pickerRow.appendChild(removeBtn);
        controls.appendChild(pickerRow);

        // Swatch strip
        var swatchContainer = document.createElement('div');
        swatchContainer.className = 'tc-swatches';
        swatchContainer.id = 'tc-swatches';
        controls.appendChild(swatchContainer);

        // Buttons
        var btnRow = document.createElement('div');
        btnRow.className = 'tc-btn-row';
        var saveBtn = document.createElement('button');
        saveBtn.className = 'tc-btn tc-btn-save';
        saveBtn.textContent = 'Save';
        saveBtn.onclick = saveCustomizer;
        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'tc-btn tc-btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = cancelCustomizer;
        var resetBtn = document.createElement('button');
        resetBtn.className = 'tc-btn tc-btn-reset';
        resetBtn.textContent = 'Reset to Defaults';
        resetBtn.onclick = resetCustomizer;
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(resetBtn);
        controls.appendChild(btnRow);

        container.appendChild(controls);

        // Iframe preview
        var previewContainer = document.createElement('div');
        previewContainer.className = 'tc-preview';
        iframe = document.createElement('iframe');
        iframe.id = 'theme-preview-iframe';
        iframe.src = '/';
        iframe.addEventListener('load', function() { applyToIframe(); });
        previewContainer.appendChild(iframe);
        container.appendChild(previewContainer);

        overlay.appendChild(container);
        return overlay;
    }

    function updatePickerForSelection() {
        var varSelect = document.getElementById('tc-var-select');
        var colorInput = document.getElementById('tc-color-picker');
        var hexInput = document.getElementById('tc-hex-input');
        var removeBtn = document.getElementById('tc-remove-override');
        if (!varSelect || !colorInput || !hexInput) return;

        var key = varSelect.value;
        var color = getCurrentColor(key);
        var hex = rgbToHex(color);
        if (!hex || hex.charAt(0) !== '#') hex = '#000000';

        colorInput.value = hex;
        hexInput.value = hex;
        removeBtn.style.display = pendingOverrides[key] ? 'inline-block' : 'none';
    }

    function updateSwatches() {
        var container = document.getElementById('tc-swatches');
        var varSelect = document.getElementById('tc-var-select');
        if (!container) return;
        container.innerHTML = '';

        allVarKeys.forEach(function(key) {
            var swatch = document.createElement('div');
            swatch.className = 'tc-swatch';
            if (pendingOverrides[key]) swatch.classList.add('tc-swatch-overridden');
            if (varSelect && varSelect.value === key) swatch.classList.add('tc-swatch-selected');

            var color = pendingOverrides[key] || rgbToHex(getResolvedBaseColor(key));
            swatch.style.backgroundColor = color;
            swatch.title = key + ': ' + color;
            swatch.onclick = function() {
                if (varSelect) {
                    varSelect.value = key;
                    updatePickerForSelection();
                }
            };
            container.appendChild(swatch);
        });
    }

    function applyPendingToDocument() {
        // First clear all overrides
        allVarKeys.forEach(function(key) {
            document.documentElement.style.removeProperty(key);
        });
        // Apply pending
        for (var key in pendingOverrides) {
            if (pendingOverrides.hasOwnProperty(key)) {
                document.documentElement.style.setProperty(key, pendingOverrides[key]);
            }
        }
    }

    function applyToIframe() {
        if (!iframe || !iframe.contentDocument) return;
        try {
            var iframeRoot = iframe.contentDocument.documentElement;
            var themeSelect = document.getElementById('tc-base-theme');
            var baseTheme = themeSelect ? themeSelect.value : getBaseTheme();
            iframeRoot.setAttribute('data-theme', baseTheme);

            // Clear previous overrides
            allVarKeys.forEach(function(key) {
                iframeRoot.style.removeProperty(key);
            });
            // Apply pending
            for (var key in pendingOverrides) {
                if (pendingOverrides.hasOwnProperty(key)) {
                    iframeRoot.style.setProperty(key, pendingOverrides[key]);
                }
            }
        } catch (e) {
            // Cross-origin or not yet loaded
        }
    }

    function saveCustomizer() {
        var themeSelect = document.getElementById('tc-base-theme');
        var baseTheme = themeSelect ? themeSelect.value : getBaseTheme();

        // Save to localStorage
        localStorage.setItem(window._themeUtils.OVERRIDES_KEY, JSON.stringify(pendingOverrides));
        localStorage.setItem(window._themeUtils.THEME_KEY, baseTheme);

        // Sync dark mode toggle
        var toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.checked = baseTheme === 'dark';

        // Apply to document
        document.documentElement.setAttribute('data-theme', baseTheme);
        applyPendingToDocument();

        savedOverrides = JSON.parse(JSON.stringify(pendingOverrides));

        // Save to API
        fetch('/api/theme/my', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseTheme: baseTheme, colorOverrides: pendingOverrides })
        });

        closeModal();
    }

    function cancelCustomizer() {
        // Restore from saved state
        pendingOverrides = JSON.parse(JSON.stringify(savedOverrides));
        var savedTheme = localStorage.getItem(window._themeUtils.THEME_KEY) || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        var toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.checked = savedTheme === 'dark';

        // Clear all inline overrides and re-apply saved
        allVarKeys.forEach(function(key) {
            document.documentElement.style.removeProperty(key);
        });
        for (var key in savedOverrides) {
            if (savedOverrides.hasOwnProperty(key)) {
                document.documentElement.style.setProperty(key, savedOverrides[key]);
            }
        }

        closeModal();
    }

    function resetCustomizer() {
        pendingOverrides = {};
        savedOverrides = {};

        // Clear localStorage overrides
        localStorage.removeItem(window._themeUtils.OVERRIDES_KEY);

        // Clear all inline style properties
        allVarKeys.forEach(function(key) {
            document.documentElement.style.removeProperty(key);
        });

        // Save to API
        var baseTheme = getBaseTheme();
        fetch('/api/theme/my', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseTheme: baseTheme, colorOverrides: {} })
        });

        closeModal();
    }

    function closeModal() {
        if (modal) {
            modal.remove();
            modal = null;
            iframe = null;
        }
    }

    window.openThemeCustomizer = function() {
        if (modal) return;

        // Load saved overrides from localStorage
        var raw = localStorage.getItem(window._themeUtils.OVERRIDES_KEY);
        try {
            savedOverrides = raw ? JSON.parse(raw) : {};
        } catch (e) {
            savedOverrides = {};
        }
        pendingOverrides = JSON.parse(JSON.stringify(savedOverrides));

        modal = buildModal();
        document.body.appendChild(modal);

        updatePickerForSelection();
        updateSwatches();

        // Also fetch from API to sync
        fetch('/api/theme/my')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data && data.colorOverrides && Object.keys(data.colorOverrides).length > 0) {
                    // If API has overrides and localStorage doesn't, sync
                    if (Object.keys(savedOverrides).length === 0) {
                        savedOverrides = data.colorOverrides;
                        pendingOverrides = JSON.parse(JSON.stringify(data.colorOverrides));
                        localStorage.setItem(window._themeUtils.OVERRIDES_KEY, JSON.stringify(data.colorOverrides));
                        applyPendingToDocument();
                        updatePickerForSelection();
                        updateSwatches();
                        applyToIframe();
                    }
                }
                if (data && data.baseTheme) {
                    var themeSelect = document.getElementById('tc-base-theme');
                    if (themeSelect) themeSelect.value = data.baseTheme;
                }
            })
            .catch(function() {});
    };
})();
