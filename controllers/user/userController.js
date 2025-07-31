const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const User = require('../../models/userSchema');
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
  res.render('user/login', {
    message: 'Account created. Please login.',
    isError: false,
    oldInput: {},
  });
};

// Handle login POST
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render('user/login', {
        message: 'Email and password are required.',
        isError: true,
        oldInput: { email },
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.render('user/login', {
        message: 'Invalid credentials.',
        isError: true,
        oldInput: { email },
      });
    }

    if (user.isBlocked) {
      return res.render('user/login', {
        message: 'Your account has been blocked. Contact admin.',
        isError: true,
        oldInput: { email },
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.render('user/login', {
        message: 'Invalid credentials.',
        isError: true,
        oldInput: { email },
      });
    }

    // Set user session only (keep admin untouched)
    req.session.user = {
      id: user._id,
      fullName: user.fullName,
      role: user.role,
      email: user.email,
    };

    res.redirect('/');
  } catch (err) {
    console.error('Error in postLogin:', err);
    res.render('user/login', {
      message: 'Server error. Please try again later.',
      isError: true,
      oldInput: { email: req.body.email || '' },
    });
  }
};

// Render signup page
exports.getSignup = (req, res) => {
  res.render('user/signup', {
    message: null,
    isError: false,
    oldInput: {},
  });
};

// Handle signup POST
exports.postSignup = async (req, res) => {
  try {
    const { fullName, email, phone, password, confirmPass } = req.body;

    if (!fullName || !email || !phone || !password || !confirmPass || password.length < 6) {
      return res.render('user/signup', {
        message: 'All fields are required and password must be at least 6 characters.',
        isError: true,
        oldInput: { fullName, email, phone },
      });
    }

    if (password !== confirmPass) {
      return res.render('user/signup', {
        message: 'Passwords do not match.',
        isError: true,
        oldInput: { fullName, email, phone },
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.render('user/signup', {
        message: 'Email or phone already exists.',
        isError: true,
        oldInput: { fullName, email, phone },
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP for verification
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store signup data and OTP in session for verification
    req.session.signupData = {
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: 'user',
      isBlocked: false,
    };

    req.session.otp = {
      code: otp,
      email,
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASS) {
      return res.render('user/signup', {
        message: 'Email service configuration error.',
        isError: true,
        oldInput: { fullName, email, phone },
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
      message: 'OTP sent to your email.',
      isError: false,
      otpExpires: req.session.otp.expires,
    });
  } catch (err) {
    console.error('Error in postSignup:', err);
    res.render('user/signup', {
      message: 'Server error. Please try again later.',
      isError: true,
      oldInput: {
        fullName: req.body.fullName,
        email: req.body.email,
        phone: req.body.phone,
      },
    });
  }
};

// Handle OTP verification
exports.verifyOtp = async (req, res) => {
  try {
    let { email, otp } = req.body;

    email = Array.isArray(email) ? email[0] : email;
    otp = Array.isArray(otp) ? otp.join('') : otp;

    if (
      !req.session.otp ||
      req.session.otp.email !== email ||
      req.session.otp.code !== otp ||
      req.session.otp.expires < Date.now()
    ) {
      return res.render('user/otp', {
        title: 'Verify OTP',
        email,
        message: 'Invalid OTP or OTP expired.',
        isError: true,
      });
    }

    if (!req.session.signupData || req.session.signupData.email !== email) {
      return res.render('user/otp', {
        title: 'Verify OTP',
        email,
        message: 'Signup data not found.',
        isError: true,
      });
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
        return res.render('user/otp', {
          title: 'Verify OTP',
          email,
          message: 'Server error.',
          isError: true,
        });
      }

      req.session.user = {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        email: user.email,
      };

      // Clean up signup data and OTP from session after successful signup
      delete req.session.otp;
      delete req.session.signupData;

      res.redirect('/');
    });
  } catch (err) {
    console.error('Error in verifyOtp:', err);
    res.render('user/otp', {
      title: 'Verify OTP',
      email: req.body.email || '',
      message: 'Server error.',
      isError: true,
    });
  }
};

// Handle OTP resend
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!req.session.signupData || req.session.signupData.email !== email) {
      return res.render('user/otp', {
        title: 'Verify OTP',
        email,
        message: 'Signup data not found.',
        isError: true,
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    req.session.otp = {
      code: otp,
      email,
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASS) {
      return res.render('user/otp', {
        title: 'Verify OTP',
        email,
        message: 'Email service configuration error.',
        isError: true,
      });
    }

    await transporter.sendMail({
      to: email,
      subject: 'SuperKicks OTP Verification',
      text: `Your new OTP is ${otp}. It expires in 5 minutes.`,
    });

    res.render('user/otp', {
      title: 'Verify OTP',
      email,
      message: 'OTP resent to your email.',
      isError: false,
      otpExpires: req.session.otp.expires,
    });
  } catch (err) {
    console.error('Error in resendOtp:', err);
    res.render('user/otp', {
      title: 'Verify OTP',
      email: req.body.email || '',
      message: 'Server error.',
      isError: true,
    });
  }
};

// Handle Google/Facebook SSO callback
exports.googleCallback = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });

    if (!user) {
      return res.render('user/login', {
        message: 'User not found. Please sign up.',
        isError: true,
        oldInput: { email: req.user.email },
      });
    }

    if (user.isBlocked) {
      return res.render('user/login', {
        message: 'Your account has been blocked. Contact admin.',
        isError: true,
        oldInput: { email: req.user.email },
      });
    }

    req.session.user = {
      id: user._id,
      fullName: user.fullName,
      role: user.role,
      email: user.email,
    };

    res.redirect('/');
  } catch (err) {
    console.error('Error in googleCallback:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};

// Render forgot password page
exports.getForgotPassword = (req, res) => {
  res.render('user/forgotPassword', {
    message: null,
    isError: false,
    oldInput: {},
  });
};

// Handle forgot password POST
exports.postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.render('user/forgotPassword', {
        message: 'Email is required.',
        isError: true,
        oldInput: { email },
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.render('user/forgotPassword', {
        message: 'Email not found.',
        isError: true,
        oldInput: { email },
      });
    }

    const token = crypto.randomBytes(20).toString('hex');

    req.session.resetToken = {
      token,
      email,
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASS) {
      return res.render('user/forgotPassword', {
        message: 'Email service configuration error.',
        isError: true,
        oldInput: { email },
      });
    }

    const resetUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/user/reset-password/${token}`;

    await transporter.sendMail({
      to: email,
      subject: 'SuperKicks Password Reset',
      text: `Reset your password here: ${resetUrl}. The link expires in 5 minutes.`,
    });

    res.render('user/forgotPassword', {
      message: 'Reset link sent to your email.',
      isError: false,
      oldInput: {},
    });
  } catch (err) {
    console.error('Error in postForgotPassword:', err);
    res.render('user/forgotPassword', {
      message: 'Server error. Please try again later.',
      isError: true,
      oldInput: { email: req.body.email || '' },
    });
  }
};

// Render reset password page
exports.getResetPassword = (req, res) => {
  try {
    const { token } = req.params;

    if (
      !req.session.resetToken ||
      req.session.resetToken.token !== token ||
      req.session.resetToken.expires < Date.now()
    ) {
      return res.render('user/forgotPassword', {
        message: 'Invalid or expired reset link.',
        isError: true,
        oldInput: {},
      });
    }

    res.render('user/resetPassword', {
      title: 'Reset Password',
      token,
      message: null,
      isError: false,
    });
  } catch (err) {
    console.error('Error in getResetPassword:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};

// Handle reset password POST
exports.postResetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (
      !req.session.resetToken ||
      req.session.resetToken.token !== token ||
      req.session.resetToken.expires < Date.now()
    ) {
      return res.render('user/forgotPassword', {
        message: 'Invalid or expired reset link.',
        isError: true,
        oldInput: {},
      });
    }

    if (!password || password.length < 6) {
      return res.render('user/resetPassword', {
        title: 'Reset Password',
        token,
        message: 'Password must be at least 6 characters long.',
        isError: true,
      });
    }

    const user = await User.findOne({ email: req.session.resetToken.email });

    if (!user) {
      return res.render('user/forgotPassword', {
        message: 'User not found.',
        isError: true,
        oldInput: {},
      });
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    req.session.regenerate((err) => {
      if (err) {
        return res.render('user/forgotPassword', {
          message: 'Server error. Please try again later.',
          isError: true,
          oldInput: {},
        });
      }

      delete req.session.resetToken;
      res.redirect('/user/login');
    });
  } catch (err) {
    console.error('Error in postResetPassword:', err);
    res.render('user/resetPassword', {
      title: 'Reset Password',
      token: req.params.token,
      message: 'Server error. Please try again later.',
      isError: true,
    });
  }
};

// Handle logout (clear only user session data, keep admin and others intact)
exports.logout = (req, res) => {
  try {
    req.session.user = null;

    // Save session changes before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session during logout:', err);
        return res.render('error/500', { title: 'Server Error' });
      }
      res.redirect('/user/login');
    });
  } catch (err) {
    console.error('Error in logout:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};
