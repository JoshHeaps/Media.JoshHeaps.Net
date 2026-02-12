// Authentication JavaScript

// Password strength checker
function checkPasswordStrength(password) {
    let strength = 0;
    const strengthBar = document.querySelector('.password-strength-bar');
    const strengthText = document.querySelector('.password-strength-text');
    const strengthContainer = document.querySelector('.password-strength');

    if (!password || password.length === 0) {
        if (strengthContainer) strengthContainer.classList.remove('active');
        if (strengthText) strengthText.classList.remove('active');
        return;
    }

    if (strengthContainer) strengthContainer.classList.add('active');
    if (strengthText) strengthText.classList.add('active');

    // Length check
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;

    // Character variety checks
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    // Update UI
    if (strengthBar) {
        strengthBar.className = 'password-strength-bar';
        if (strength <= 2) {
            strengthBar.classList.add('weak');
            if (strengthText) {
                strengthText.textContent = 'Weak password';
                strengthText.style.color = 'var(--danger-color)';
            }
        } else if (strength <= 4) {
            strengthBar.classList.add('medium');
            if (strengthText) {
                strengthText.textContent = 'Medium password';
                strengthText.style.color = 'var(--warning-color)';
            }
        } else {
            strengthBar.classList.add('strong');
            if (strengthText) {
                strengthText.textContent = 'Strong password';
                strengthText.style.color = 'var(--success-color)';
            }
        }
    }

    return strength;
}

// Password visibility toggle
function initPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach(button => {
        button.addEventListener('click', function() {
            const input = this.previousElementSibling;
            if (input && input.type === 'password') {
                input.type = 'text';
                this.textContent = 'Hide';
            } else if (input) {
                input.type = 'password';
                this.textContent = 'Show';
            }
        });
    });
}

// Form validation
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateUsername(username) {
    // Username: 3-50 characters, alphanumeric and underscores only
    const re = /^[a-zA-Z0-9_]{3,50}$/;
    return re.test(username);
}

function validatePassword(password) {
    // Minimum 8 characters
    return password && password.length >= 8;
}

function showError(input, message) {
    input.classList.add('is-invalid');
    let feedback = input.nextElementSibling;
    if (!feedback || !feedback.classList.contains('invalid-feedback')) {
        feedback = document.createElement('div');
        feedback.className = 'invalid-feedback';
        input.parentNode.insertBefore(feedback, input.nextSibling);
    }
    feedback.textContent = message;
}

function clearError(input) {
    input.classList.remove('is-invalid');
    const feedback = input.nextElementSibling;
    if (feedback && feedback.classList.contains('invalid-feedback')) {
        feedback.textContent = '';
    }
}

// Login form validation
function initLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    // Real-time validation
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (!this.value.trim()) {
                showError(this, 'Email or username is required');
            } else {
                clearError(this);
            }
        });

        emailInput.addEventListener('input', function() {
            if (this.value.trim()) {
                clearError(this);
            }
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener('blur', function() {
            if (!this.value) {
                showError(this, 'Password is required');
            } else {
                clearError(this);
            }
        });

        passwordInput.addEventListener('input', function() {
            if (this.value) {
                clearError(this);
            }
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        let isValid = true;

        // Validate email/username
        if (!emailInput.value.trim()) {
            showError(emailInput, 'Email or username is required');
            isValid = false;
        } else {
            clearError(emailInput);
        }

        // Validate password
        if (!passwordInput.value) {
            showError(passwordInput, 'Password is required');
            isValid = false;
        } else {
            clearError(passwordInput);
        }

        if (isValid) {
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Logging in...';

            // Submit the form
            form.submit();
        }
    });
}

// Registration form validation
function initRegisterForm() {
    const form = document.getElementById('registerForm');
    if (!form) return;

    const emailInput = document.getElementById('email');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    // Email validation
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (!this.value.trim()) {
                showError(this, 'Email is required');
            } else if (!validateEmail(this.value)) {
                showError(this, 'Please enter a valid email address');
            } else {
                clearError(this);
            }
        });

        emailInput.addEventListener('input', function() {
            if (this.value.trim() && validateEmail(this.value)) {
                clearError(this);
            }
        });
    }

    // Username validation
    if (usernameInput) {
        usernameInput.addEventListener('blur', function() {
            if (!this.value.trim()) {
                showError(this, 'Username is required');
            } else if (!validateUsername(this.value)) {
                showError(this, 'Username must be 3-50 characters, alphanumeric and underscores only');
            } else {
                clearError(this);
            }
        });

        usernameInput.addEventListener('input', function() {
            if (this.value.trim() && validateUsername(this.value)) {
                clearError(this);
            }
        });
    }

    // Password validation with strength checker
    if (passwordInput) {
        passwordInput.addEventListener('input', function() {
            checkPasswordStrength(this.value);
            if (this.value && validatePassword(this.value)) {
                clearError(this);
            }

            // Also validate confirm password if it has a value
            if (confirmPasswordInput && confirmPasswordInput.value) {
                if (confirmPasswordInput.value === this.value) {
                    clearError(confirmPasswordInput);
                } else {
                    showError(confirmPasswordInput, 'Passwords do not match');
                }
            }
        });

        passwordInput.addEventListener('blur', function() {
            if (!this.value) {
                showError(this, 'Password is required');
            } else if (!validatePassword(this.value)) {
                showError(this, 'Password must be at least 8 characters');
            } else {
                clearError(this);
            }
        });
    }

    // Confirm password validation
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', function() {
            if (passwordInput && this.value === passwordInput.value) {
                clearError(this);
            }
        });

        confirmPasswordInput.addEventListener('blur', function() {
            if (!this.value) {
                showError(this, 'Please confirm your password');
            } else if (passwordInput && this.value !== passwordInput.value) {
                showError(this, 'Passwords do not match');
            } else {
                clearError(this);
            }
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        let isValid = true;

        // Validate email
        if (!emailInput.value.trim()) {
            showError(emailInput, 'Email is required');
            isValid = false;
        } else if (!validateEmail(emailInput.value)) {
            showError(emailInput, 'Please enter a valid email address');
            isValid = false;
        } else {
            clearError(emailInput);
        }

        // Validate username
        if (!usernameInput.value.trim()) {
            showError(usernameInput, 'Username is required');
            isValid = false;
        } else if (!validateUsername(usernameInput.value)) {
            showError(usernameInput, 'Username must be 3-50 characters, alphanumeric and underscores only');
            isValid = false;
        } else {
            clearError(usernameInput);
        }

        // Validate password
        if (!passwordInput.value) {
            showError(passwordInput, 'Password is required');
            isValid = false;
        } else if (!validatePassword(passwordInput.value)) {
            showError(passwordInput, 'Password must be at least 8 characters');
            isValid = false;
        } else {
            clearError(passwordInput);
        }

        // Validate confirm password
        if (!confirmPasswordInput.value) {
            showError(confirmPasswordInput, 'Please confirm your password');
            isValid = false;
        } else if (confirmPasswordInput.value !== passwordInput.value) {
            showError(confirmPasswordInput, 'Passwords do not match');
            isValid = false;
        } else {
            clearError(confirmPasswordInput);
        }

        if (isValid) {
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Creating account...';

            // Submit the form
            form.submit();
        }
    });
}

// Password reset form validation
function initPasswordResetForm() {
    const form = document.getElementById('resetPasswordForm');
    if (!form) return;

    const passwordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    if (passwordInput) {
        passwordInput.addEventListener('input', function() {
            checkPasswordStrength(this.value);
            if (this.value && validatePassword(this.value)) {
                clearError(this);
            }

            if (confirmPasswordInput && confirmPasswordInput.value) {
                if (confirmPasswordInput.value === this.value) {
                    clearError(confirmPasswordInput);
                } else {
                    showError(confirmPasswordInput, 'Passwords do not match');
                }
            }
        });

        passwordInput.addEventListener('blur', function() {
            if (!this.value) {
                showError(this, 'Password is required');
            } else if (!validatePassword(this.value)) {
                showError(this, 'Password must be at least 8 characters');
            } else {
                clearError(this);
            }
        });
    }

    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', function() {
            if (passwordInput && this.value === passwordInput.value) {
                clearError(this);
            }
        });

        confirmPasswordInput.addEventListener('blur', function() {
            if (!this.value) {
                showError(this, 'Please confirm your password');
            } else if (passwordInput && this.value !== passwordInput.value) {
                showError(this, 'Passwords do not match');
            } else {
                clearError(this);
            }
        });
    }

    form.addEventListener('submit', function(e) {
        e.preventDefault();

        let isValid = true;

        if (!passwordInput.value) {
            showError(passwordInput, 'Password is required');
            isValid = false;
        } else if (!validatePassword(passwordInput.value)) {
            showError(passwordInput, 'Password must be at least 8 characters');
            isValid = false;
        } else {
            clearError(passwordInput);
        }

        if (!confirmPasswordInput.value) {
            showError(confirmPasswordInput, 'Please confirm your password');
            isValid = false;
        } else if (confirmPasswordInput.value !== passwordInput.value) {
            showError(confirmPasswordInput, 'Passwords do not match');
            isValid = false;
        } else {
            clearError(confirmPasswordInput);
        }

        if (isValid) {
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Resetting...';
            form.submit();
        }
    });
}

// Request reset form validation
function initRequestResetForm() {
    const form = document.getElementById('requestResetForm');
    if (!form) return;

    const emailInput = document.getElementById('email');

    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (!this.value.trim()) {
                showError(this, 'Email is required');
            } else if (!validateEmail(this.value)) {
                showError(this, 'Please enter a valid email address');
            } else {
                clearError(this);
            }
        });

        emailInput.addEventListener('input', function() {
            if (this.value.trim() && validateEmail(this.value)) {
                clearError(this);
            }
        });
    }

    form.addEventListener('submit', function(e) {
        e.preventDefault();

        if (!emailInput.value.trim()) {
            showError(emailInput, 'Email is required');
            return;
        }

        if (!validateEmail(emailInput.value)) {
            showError(emailInput, 'Please enter a valid email address');
            return;
        }

        clearError(emailInput);

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Sending...';
        form.submit();
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    initPasswordToggles();
    initLoginForm();
    initRegisterForm();
    initPasswordResetForm();
    initRequestResetForm();
});
