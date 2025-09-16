document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form');
  const fullNameInput = form.querySelector('input[name="fullName"]');
  const emailInput = form.querySelector('input[name="email"]');
  const phoneInput = form.querySelector('input[name="phone"]');
  const passwordInput = form.querySelector('input[name="password"]');
  const confirmPassInput = form.querySelector('input[name="Confirmpass"]');

  form.addEventListener('submit', (event) => {
    // Remove previous error messages
    document.querySelectorAll('.client-error').forEach(error => error.remove());
    let isValid = true;

    const showError = (input, message) => {
      isValid = false;
      const errorEl = document.createElement('p');
      errorEl.className = 'client-error text-red-600 text-sm mt-1';
      errorEl.textContent = message;
      input.parentNode.appendChild(errorEl);
    };

    // Validate full name
    if (!fullNameInput.value.trim() || fullNameInput.value.trim().length < 2) {
      showError(fullNameInput, 'Full Name must be at least 2 characters');
    }

    // Validate email format
    const emailValue = emailInput.value.trim();
    if (!emailValue) {
      showError(emailInput, 'Email is required');
    } else {
      // A more robust regex for basic email validation
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(emailValue)) {
        showError(emailInput, 'Invalid email format (e.g., user@example.com)');
      }
    }

    // Validate phone number
    const phoneValue = phoneInput.value.trim();
    if (!phoneValue) {
      showError(phoneInput, 'Phone number is required');
    } else {
      const phonePattern = /^\d{7,15}$/;
      if (!phonePattern.test(phoneValue)) {
        showError(phoneInput, 'Phone number must be 7 to 15 digits');
      }
    }

    // Validate password
    const passwordValue = passwordInput.value;
    if (!passwordValue) {
      showError(passwordInput, 'Password is required');
    } else if (passwordValue.length < 6) {
      showError(passwordInput, 'Password must be at least 6 characters');
    } else {
      const specialCharPattern = /[!@#$%^&*(),.?":{}|<>]/;
      if (!specialCharPattern.test(passwordValue)) {
        showError(passwordInput, 'Password must include at least one special character');
      }
    }

    // Confirm password match
    if (confirmPassInput.value !== passwordInput.value) {
      showError(confirmPassInput, 'Passwords do not match');
    }

    if (!isValid) {
      event.preventDefault(); // Stop submission
    }
  });
});