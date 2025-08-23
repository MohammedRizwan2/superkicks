const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/userSchema'); // Capitalized model
const userController = require('../controllers/user/userController');
const productController = require('../controllers/user/productController'); 
const categoryController  = require('../controllers/user/categoryController')
const profileController = require('../controllers/user/profileController')
const addressController = require('../controllers/user/addressController');
const { avatarUpload } = require('../config/multer');
const cartController = require('../controllers/user/cartController');
const checkoutController = require('../controllers/user/checkoutController')
const orderController = require('../controllers/user/orderController');
const wishListController = require('../controllers/user/wishListController')
;
const headerload = require('../middleware/header');
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


router.use(headerload);
// Protected product routes 
router.get('/product/list', isAuthenticated, checkUserBlocked, productController.getShop);
router.get('/products/:id', isAuthenticated, checkUserBlocked, productController.getProductDetails);
router.get('/products/variants/:variantId',isAuthenticated,checkUserBlocked, productController.getVariantDetails);

//category
router.get('/categories/:id',isAuthenticated,checkUserBlocked,categoryController.getCategoryPage);
router.get('/categories',isAuthenticated,checkUserBlocked,categoryController.getCategoriesPage)





//profile
router.get('/profile',isAuthenticated,profileController.getProfile);

router.get('/profile/edit',isAuthenticated,profileController.getProfileEdit);
router.put('/api/password',profileController.changePassword)
router.post('/api/email/request-change',profileController.initiateEmailChange)
router.post('/api/email/verify-change',profileController.confirmEmailChange)
router.post('/api/email/resend-otp',profileController.resendEmailChangeOtp)


router.put('/api/profile',profileController.updateProfile);
router.post('/api/avatar',avatarUpload,profileController.uploadAvatar,);
router.delete('/api/avatar',profileController.removeAvatar);






//addresses
router.get('/addresses',isAuthenticated,addressController.getAddresses)


router.post('/api/address', addressController.addAddress);
router.get('/api/address', addressController.getUserAddresses);
router.get('/api/address/:id', addressController.getAddress);
router.put('/api/address/:id', addressController.updateAddress);
router.delete('/api/address/:id', addressController.deleteAddress);
router.put('/api/address/:id/default',addressController.setDefaultAddress);

//cart
router.get('/cart', cartController.renderCart);


router.get('/api/cart', cartController.getCart);
router.post('/api/cart', cartController.addToCart);
router.put('/api/cart/item/:variantId', cartController.updateCartQuantity);
router.delete('/api/cart/item/:variantId', cartController.removeFromCart);
router.delete('/api/cart', cartController.clearCart);

//checkout order

router.get('/checkout',checkoutController.renderCheckout)
router.post('/api/order',checkoutController.placeOrder)
router.get('/order-success/:orderId',checkoutController.orderSuccess)
router.get('/orders/:orderId',orderController.orderDetails)
router.get('/orders/:orderId/invoice',orderController.downloadInvoice);

router.get('/orders',orderController.orderList)
router.get('/api/orders',orderController.getOrders);
router.put('/api/orders/:orderId/cancel',orderController.cancelOrder);
router.put('/api/orders/:orderId/items/:itemId/cancel',orderController.cancelOrderItem);
router.get('/api/orders/search',orderController.searchOrders);
router.post('/api/orders/:orderId/returns',orderController.requestReturn);
router.put('/api/orders/:orderId/items/:itemId/return', orderController.returnOrderItem);


router.post('/api/wishlist/:variantId',wishListController.addToWishlist)
router.delete('/api/wishlist/:variantId',wishListController.removeFromWishlist);
router.get('/api/wishlist/:variantId ',wishListController.checkWishlistStatus);
router.get('/wishlist',wishListController.renderWishlistPage)
router.delete('/api/wishlist',wishListController.clearWishlist)
router.get('/api/wishlist',wishListController.getWishlist);




// Logout route
router.get('/logout', isAuthenticated, userController.logout);







module.exports = router;
