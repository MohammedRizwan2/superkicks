const User = require('../../models/userSchema');
const bcrypt = require('bcryptjs');

// Render admin login page
exports.getAdminLogin = (req, res) => {
  res.render('admin/login');
};

// Handle admin login POST
exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  let errorMessage = '';

  try {
    if (!email || !password) {
      errorMessage = 'Email and password are required.';
      return res.status(400).render('admin/login', { errorMessage, oldInput: { email } });
    }

    // Normalize email for lookup
    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      errorMessage = 'Invalid email or password.';
      return res.status(401).render('admin/login', { errorMessage, oldInput: { email } });
    }

    // Check password validity
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      errorMessage = 'Invalid email or password.';
      return res.status(401).render('admin/login', { errorMessage, oldInput: { email } });
    }

    // Check if user is admin
    if (user.role !== 'admin') {
      errorMessage = 'Access denied. You are not an admin.';
      return res.status(403).render('admin/login', { errorMessage, oldInput: { email } });
    }

    // Set admin session data without affecting user session data
    req.session.admin = {
      id: user._id,
      email: user.email,
      role: user.role,  // helpful for authorization checks
    };

    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Admin login error:', err);
    errorMessage = 'Server error, please try again later.';
    return res.status(500).render('admin/login', { errorMessage, oldInput: { email } });
  }
};

// Render admin dashboard
exports.getDashboard = async (req, res) => {
  try {
    res.render('admin/dashboard', { title: 'Admin Dashboard' });
  } catch (err) {
    console.error(err);
    res.render('error/500', { title: 'Server Error' });
  }
};

// Optional: Admin logout handler clearing only admin session data
exports.logout = (req, res) => {
  try {
    req.session.admin = null;

    req.session.save((err) => {
      if (err) {
        console.error('Error saving session during admin logout:', err);
        return res.render('error/500', { title: 'Server Error' });
      }
      res.redirect('/admin/login');
    });
  } catch (err) {
    console.error('Error in admin logout:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};
