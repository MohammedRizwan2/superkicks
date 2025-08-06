const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/userSchema'); // Capitalized model
const userController = require('../controllers/user/userController');
const productController = require('../controllers/user/productController'); // Fixed spelling

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  try {
    if (req.session && req.session.user) {
      
      return next();
    } else {
      
      return res.redirect('/user/login');
    }
  } catch (err) {
    console.error('Error in isAuthenticated middleware:', err);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Middleware to check if user is NOT authenticated
const isNotAuthenticated = (req, res, next) => {
  try {
   
    if (!req.session.user) {

      return next();
    }

    res.redirect('/');
  } catch (err) {
    console.error('Error in isNotAuthenticated middleware:', err);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Middleware to check if user is blocked
const checkUserBlocked = async (req, res, next) => {
  try {
    if (req.session && req.session.user) {
      const user = await User.findOne({ email: req.session.user.email });
      if (!user || user.isBlocked) {
        const email = req.session.user.email;
        req.session.user = null;
        return res.render('user/login', {
          message: "Your account has been blocked by admin.",
          isError: true,
          oldInput: { email },
        });
      }
    }
    next();
  } catch (err) {
    console.error('Error in checkUserBlocked middleware:', err);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Login routes
router.get('/login', isNotAuthenticated, userController.getLogin);
router.post('/login', isNotAuthenticated, userController.postLogin);

// Signup routes
router.get('/signup', isNotAuthenticated, userController.getSignup);
router.post('/signup', isNotAuthenticated, userController.postSignup);

// OTP routes
router.post('/verify-otp', isNotAuthenticated, userController.verifyOtp);
router.post('/resend-otp', isNotAuthenticated, userController.resendOtp);

// Google OAuth routes (SSO)
router.get(
  '/auth/google',isNotAuthenticated,
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get(
  '/auth/google/callback',isNotAuthenticated,
  passport.authenticate('google', { failureRedirect: '/user/login' }),
  userController.googleCallback
);

// Forgot password routes
router.get('/forgot-password', isNotAuthenticated, userController.getForgotPassword);
router.post('/forgot-password', isNotAuthenticated, userController.postForgotPassword);
router.get('/reset-password/:token', isNotAuthenticated, userController.getResetPassword);
router.post('/reset-password/:token', isNotAuthenticated, userController.postResetPassword);

// Protected product routes 
router.get('/product/list', isAuthenticated, checkUserBlocked, productController.getShop);
router.get('/products/:id', isAuthenticated, checkUserBlocked, productController.getProductDetails);
router.get('/products/variants/:variantId',isAuthenticated,checkUserBlocked, productController.getVariantDetails);

// Logout route
router.get('/logout', isAuthenticated, userController.logout);

module.exports = router;
