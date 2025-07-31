const express = require('express');
const router = express.Router();
const passport = require('passport');
const userController = require('../controllers/user/userController');
const productContoller = require('../controllers/user/productController');
// const userAuth = require('../middleware/userAuth');





async function userIsNotBlocked(req, res, next) {
  if (!req.session.user) {
    return next();  
  }

  try {
    const user = await User.find(req.session.user.email);
    
    if (!user) {
      req.session.destroy(() => {
        return res.redirect('/user/login');
      });
      return;
    }

    if (user.isBlocked) {
      // User is blocked - destroy session & show message
      req.session.destroy(() => {
        // Option 1: Use flash messages if implemented
        // req.flash('error', 'Your account is blocked. Contact admin.');
        // res.redirect('/login');

        // Option 2: Pass a query param and show message in login page
        res.redirect('/user/login?blocked=1');
      });
      return;
    }

    // User is fine, proceed
    next();
  } catch (err) {
    console.error('Session validation error:', err);
    // In case of error, forcibly logout to be safe
    req.session.destroy(() => {
      res.redirect('/user/login');
    });
  }
}

module.exports = userIsNotBlocked;





// Verify controller import
if (!userController || !userController.getLogin) {
  console.error('Error: userController or userController.getLogin is undefined. Check controllers/userController.js');
  throw new Error('userController.getLogin is not defined');
}

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  try {
    if (req.session.user) {
      return next();
    }
    res.redirect('/user/login');
  } catch (err) {
    console.error('Error in isAuthenticated middleware:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};

// Middleware to check if user is not authenticated
const isNotAuthenticated = (req, res, next) => {
  try {
    if (!req.session.user) {
      return next();
    }
    res.redirect('/');
  } catch (err) {
    console.error('Error in isNotAuthenticated middleware:', err);
    res.render('error/500', { title: 'Server Error' });
  }
};
// router.use(userIsNotBlocked)
// Login routes
router.get('/login', isNotAuthenticated, userController.getLogin);
router.post('/login', isNotAuthenticated, userController.postLogin);

// Signup routes
router.get('/signup', isNotAuthenticated, userController.getSignup);
router.post('/signup', isNotAuthenticated, userController.postSignup);

// OTP routes
router.post('/verify-otp', isNotAuthenticated, userController.verifyOtp);
router.post('/resend-otp', isNotAuthenticated, userController.resendOtp);

// SSO routes
router.get('/auth/google', isNotAuthenticated, passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback', isNotAuthenticated, passport.authenticate('google', { failureRedirect: '/user/login' }), userController.googleCallback);


// Password reset routes
router.get('/forgot-password', isNotAuthenticated, userController.getForgotPassword);
router.post('/forgot-password', isNotAuthenticated, userController.postForgotPassword);
router.get('/reset-password/:token', isNotAuthenticated, userController.getResetPassword);
router.post('/reset-password/:token', isNotAuthenticated, userController.postResetPassword);

//products
router.get('/product/list',isAuthenticated,productContoller.getShop);
router.get('/products/:id',isAuthenticated,productContoller.getProductDetails)

// Logout route
router.get('/logout', isAuthenticated, userController.logout);

module.exports = router;