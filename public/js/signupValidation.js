document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form');
  const fullNameInput = form.querySelector('input[name="fullName"]');
  const emailInput = form.querySelector('input[name="email"]');
  const phoneInput = form.querySelector('input[name="phone"]');
  const passwordInput = form.querySelector('input[name="password"]');
  const confirmPassInput = form.querySelector('input[name="Confirmpass"]');

  form.addEventListener('submit', (event) => {
    // Remove previous error messages
    const previousErrors = document.querySelectorAll('.client-error');
    previousErrors.forEach(error => error.remove());

    let isValid = true;

    function showError(input, message) {
      isValid = false;
      const errorEl = document.createElement('p');
      errorEl.className = 'client-error text-red-600 text-sm mt-1';
      errorEl.textContent = message;
      input.parentNode.appendChild(errorEl);
    }

    // Validate full name
    if (!fullNameInput.value.trim()) {
      showError(fullNameInput, 'Full Name is required');
    } else if (fullNameInput.value.trim().length < 2) {
      showError(fullNameInput, 'Full Name must be at least 2 characters');
    }

    // Validate email format (basic check)
    if (!emailInput.value.trim()) {
      showError(emailInput, 'Email is required');
    } else {
      const emailPattern = /^\S+@\S+\.\S+$/;
      if (!emailPattern.test(emailInput.value.trim())) {
        showError(emailInput, 'Invalid email format');
      }
    }

    // Validate phone number (digits only, 7-15 length)
    if (!phoneInput.value.trim()) {
      showError(phoneInput, 'Phone number is required');
    } else {
      const phonePattern = /^\d{7,15}$/;
      if (!phonePattern.test(phoneInput.value.trim())) {
        showError(phoneInput, 'Phone number must be 7 to 15 digits');
      }
    }

    // Validate password length and special character
    if (!passwordInput.value) {
      showError(passwordInput, 'Password is required');
    } else if (passwordInput.value.length < 6) {
      showError(passwordInput, 'Password must be at least 6 characters');
    } else {
      const specialCharPattern = /[!@#$%^&*(),.?":{}|<>]/;
      if (!specialCharPattern.test(passwordInput.value)) {
        showError(passwordInput, 'Password must include at least one special character');
      }
    }

    // Confirm password match
    if (confirmPassInput.value !== passwordInput.value) {
      showError(confirmPassInput, 'Passwords do not match');
    }

    if (!isValid) {
      event.preventDefault(); // Prevent form submission if validation fails
    }
  });
});
