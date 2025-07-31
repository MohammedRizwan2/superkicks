const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const User = require('../../models/User');

require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODEMAILER_EMAIL,
    pass: process.env.NODEMAILER_PASS,
  },
});

// Render login page
exports.getLogin = (req, res) => {
  console.log('getLogin called');
  res.render('user/login', { title: 'Login', error: null, message: null });
};

// Handle login
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('postLogin called with:', { email });
    if (!email || !password) {
      return res.render('user/login', { title: 'Login', error: 'Email and password are required', message: null });
    }
    const user = await User.findOne({ email });
    if (!user || user.isBlocked || !(await bcrypt.compare(password, user.password))) {
      return res.render('user/login', { title: 'Login', error: 'Invalid credentials or account blocked', message: null });
    }
    req.session.regenerate((err) => {
      if (err) {
        console.error('Error in session regeneration (postLogin):', err);
        return res.render('user/login', { title: 'Login', error: 'Server error', message: null });
      }
      req.session.user = { id: user._id, fullName: user.fullName, role: user.role, email: user.email };
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error in postLogin:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};

//Render signup page
exports.getSignup = (req, res) => {
  console.log(' trigger here');
  res.render("user/signup", { title: 'Sign Up', error: null, message: null });
};



// Handle signup
exports.postSignup = async (req, res) => {
  try {
    const { fullName, email, phone, password, Confirmpass } = req.body;
    console.log('postSignup called with:', { fullName, email, phone });
    if (!fullName || !email || !phone || !password || !Confirmpass || password.length < 6) {
      return res.render('user/signup', {
        title: 'Sign Up',
        error: 'All fields required, password must be 6+ characters',
        message: null,
      });
    }
    if (password !== Confirmpass) {
      return res.render('user/signup', {
        title: 'Sign Up',
        error: 'Passwords do not match',
        message: null,
      });
    }
    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.render('user/signup', {
        title: 'Sign Up',
        error: 'Email or phone already exists',
        message: null,
      });
    }
  
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.signupData = {
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: 'user',
      isBlocked:false,
    };
    req.session.otp = {
      code: otp,
      email,
      expires: Date.now() + 5 * 60 * 1000,
    };
    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASS) {
      console.error('Nodemailer credentials missing:', {
        email: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASS,
      });
      return res.render('user/signup', {
        title: 'Sign Up',
        error: 'Email service configuration error',
        message: null,
      });
    }
    await transporter.sendMail({
      to: email,
      subject: 'SuperKicks OTP Verification',
      text: `Your OTP is ${otp}. It expires in 5 minutes.`,
    });
    res.render('user/otp', {
      title: 'Verify OTP',
      email,
      error: null,
      message: 'OTP sent to your email',
      otpExpires: req.session.otp.expires,
    });
  } catch (err) {
    console.error('Error in postSignup:', err);
    res.render('user/signup', { title: 'Sign Up', error: 'Server error', message: null });
  }
};


// Handle OTP verification
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    
    const emailValue = Array.isArray(email) ? email[0] : email;
    const otpValue = Array.isArray(otp) ? otp.join('') : otp;
    
    if (!req.session.otp || req.session.otp.email !== emailValue || req.session.otp.code !== otpValue ||req.session.otp.expires<Date.now()) {
      return res.render('user/otp', { title: 'Verify OTP', email: emailValue, error: 'Invalid OTP/OTP expired', message: null });
    }
    if (!req.session.signupData || req.session.signupData.email !== emailValue) {
      return res.render('user/otp', { title: 'Verify OTP', email: emailValue, error: 'Signup data not found', message: null });
    }


    const { fullName, email: signupEmail, phone, password, role, isBlocked } = req.session.signupData;
    const user = new User({
      fullName,
      email: signupEmail,
      phone,
      password,
      role,
      isBlocked,
    });
    await user.save();
    req.session.regenerate((err) => {
      if (err) {
        console.error('Error in session regeneration (verifyOtp):', err);
        return res.render('user/otp', { title: 'Verify OTP', email: emailValue, error: 'Server error', message: null });
      }
      req.session.user = { id: user._id, fullName: user.fullName, role: user.role, email: user.email };
      delete req.session.otp;
      delete req.session.signupData;
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error in verifyOtp:', err);
    res.render('user/otp', { title: 'Verify OTP', email: req.body.email, error: 'Server error', message: null });
  }
};
// Handle OTP resend
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    console.log('resendOtp called with:', { email });
    if (!req.session.signupData || req.session.signupData.email !== email) {
      return res.render('user/otp', { title: 'Verify OTP', email, error: 'Signup data not found', message: null });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = {
      code: otp,
      email,
      expires: Date.now() + 5 * 60 * 1000, // Extended to 30 minutes for testing
    };
    console.log('Resent OTP:', otp, 'Expires at:', new Date(req.session.otp.expires).toISOString());
    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASS) {
      console.error('Nodemailer credentials missing:', {
        email: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASS,
      });
      return res.render('user/otp', {
        title: 'Verify OTP',
        email,
        error: 'Email service configuration error',
        message: null,
      });
    }
    await transporter.sendMail({
      to: email,
      subject: 'SuperKicks OTP Verification',
      text: `Your new OTP is ${otp}. It expires in 30 minutes.`,
    });
    res.render('user/otp', {
      title: 'Verify OTP',
      email,
      error: null,
      message: 'OTP resent to your email',
      otpExpires: req.session.otp.expires,
    });
  } catch (err) {
    console.error('Error in resendOtp:', err);
    res.render('user/otp', { title: 'Verify OTP', email: req.body.email, error: 'Server error', message: null });
  }
};

// Handle Google/Facebook SSO callback
exports.googleCallback = (req, res) => {
  try {
    // Check if user is blocked
    if (req.user && req.user.isBlocked) {
      return res.render('user/login', {
        Message: 'Your account has been blocked. Contact admin.',
        oldInput: { email: req.user.email }
      });
    }
    req.session.regenerate((err) => {
      if (err) {
        console.error('Error in session regeneration (googleCallback):', err);
        return res.redirect('/user/login');
      }
      req.session.user = {
        id: req.user._id,
        fullName: req.user.fullName,
        role: req.user.role,
        email: req.user.email
      };
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error in googleCallback:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};


// Render forgot password page
exports.getForgotPassword = (req, res) => {
  console.log('getForgotPassword called');
  res.render('user/forgotPassword', { title: 'Forgot Password', error: null, message: null });
};

// Handle forgot password
exports.postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    console.log('postForgotPassword called with:', { email });
    if (!email) {
      return res.render('user/forgotPassword', { title: 'Forgot Password', error: 'Email is required', message: null });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('user/forgotPassword', { title: 'Forgot Password', error: 'Email not found', message: null });
    }
    const token = crypto.randomBytes(20).toString('hex');
    req.session.resetToken = {
      token,
      email,
      expires: Date.now() + 5 * 60 * 1000, 
    };
    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASS) {
      console.error('Nodemailer credentials missing:', {
        email: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASS,
      });
      return res.render('user/forgotPassword', {
        title: 'Forgot Password',
        error: 'Email service configuration error',
        message: null,
      });
    }
    await transporter.sendMail({
      to: email,
      subject: 'SuperKicks Password Reset',
      text: `Reset your password: http://localhost:3000/user/reset-password/${token}`,
    });
    res.render('user/forgotPassword', { title: 'Forgot Password', error: null, message: 'Reset link sent to your email' });
  } catch (err) {
    console.error('Error in postForgotPassword:', err);
    res.render('user/forgotPassword', { title: 'Forgot Password', error: 'Server error', message: null });
  }
};

// Render reset password page
exports.getResetPassword = (req, res) => {
  try {
    const { token } = req.params;
    console.log('getResetPassword called with token:', token);
    if (!req.session.resetToken || req.session.resetToken.token !== token || req.session.resetToken.expires < Date.now()) {
      return res.render('user/forgotPassword', { title: 'Forgot Password', error: 'Invalid or expired reset link', message: null });
    }
    res.render('user/resetPassword', { title: 'Reset Password', token, error: null, message: null });
  } catch (err) {
    console.error('Error in getResetPassword:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};

// Handle reset password
exports.postResetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    console.log('postResetPassword called with token:', token);
    if (!req.session.resetToken || req.session.resetToken.token !== token || req.session.resetToken.expires < Date.now()) {
      return res.render('user/forgotPassword', { title: 'Forgot Password', error: 'Invalid or expired reset link', message: null });
    }
    if (!password || password.length < 6) {
      return res.render('user/resetPassword', { title: 'Reset Password', token, error: 'Password must be at least 6 characters', message: null });
    }
    const user = await User.findOne({ email: req.session.resetToken.email });
    if (!user) {
      return res.render('user/forgotPassword', { title: 'Forgot Password', error: 'User not found', message: null });
    }
    user.password = await bcrypt.hash(password, 10);
    await user.save();
    req.session.regenerate((err) => {
      if (err) {
        console.error('Error in session regeneration (postResetPassword):', err);
        return res.render('user/forgotPassword', { title: 'Forgot Password', error: 'Server error', message: null });
      }
      delete req.session.resetToken;
      res.redirect('/user/login');
    });
  } catch (err) {
    console.error('Error in postResetPassword:', err);
    res.render('user/resetPassword', { title: 'Reset Password', token: req.params.token, error: 'Server error', message: null });
  }
};

// Handle logout
exports.logout = (req, res) => {
  try {
    console.log('logout called');
    req.session.destroy((err) => {
      if (err) {
        console.error('Error in session destruction (logout):', err);
        return res.redirect('/');
      }
      res.redirect('/user/login');
    });
  } catch (err) {
    console.error('Error in logout:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};

module.exports = exports;