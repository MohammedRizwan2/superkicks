document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form');
  form.addEventListener('submit', (e) => {
    const fullName = form.querySelector('input[name="fullName"]').value.trim();
    const email = form.querySelector('input[name="email"]').value.trim();
    const phone = form.querySelector('input[name="phone"]').value.trim();
    const password = form.querySelector('input[name="password"]').value;
    const confirmPass = form.querySelector('input[name="Confirmpass"]').value;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\d{10}$/;
    
    if (!fullName || !email || !phone || !password || !confirmPass) {
      e.preventDefault();
      alert('All fields are required');
      return;
    }
    
    if (!emailRegex.test(email)) {
      e.preventDefault();
      alert('Please enter a valid email address');
      return;
    }
    
    if (!phoneRegex.test(phone)) {
      e.preventDefault();
      alert('Please enter a valid 10-digit phone number');
      return;
    }
    
    if (password.length < 6) {
      e.preventDefault();
      alert('Password must be at least 6 characters');
      return;
    }
    
    if (password !== confirmPass) {
      e.preventDefault();
      alert('Passwords do not match');
      return;
    }
  });
});