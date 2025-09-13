const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/userSchema'); // Capitalized model
const userController = require('../controllers/user/userController');
const productController = require('../controllers/user/productController');
const categoryController = require('../controllers/user/categoryController')
const profileController = require('../controllers/user/profileController')
const addressController = require('../controllers/user/addressController');
const { avatarUpload } = require('../config/multer');
const cartController = require('../controllers/user/cartController');
const checkoutController = require('../controllers/user/checkoutController')
const orderController = require('../controllers/user/orderController');
const wishListController = require('../controllers/user/wishListController');
const walletController = require('../controllers/user/walletController');
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
    '/auth/google', isNotAuthenticated,
    passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get(
    '/auth/google/callback', isNotAuthenticated,
    passport.authenticate('google', { failureRedirect: '/user/login' }),
    userController.googleCallback
);

// Forgot password routes
router.get('/forgot-password', isNotAuthenticated, userController.getForgotPassword);
router.post('/forgot-password', isNotAuthenticated, userController.postForgotPassword);
router.get('/reset-password/:token', isNotAuthenticated, userController.getResetPassword);
router.post('/reset-password/:token', isNotAuthenticated, userController.postResetPassword);

// Apply header middleware to all routes that need it
router.use(headerload);

// Protected product routes 
router.get('/product/list', isAuthenticated, checkUserBlocked, productController.getShop);
router.get('/products/:id', isAuthenticated, checkUserBlocked, productController.getProductDetails);
router.get('/products/variants/:variantId', isAuthenticated, checkUserBlocked, productController.getVariantDetails);

//category
router.get('/categories/:id', isAuthenticated, checkUserBlocked, categoryController.getCategoryPage);
router.get('/categories', isAuthenticated, checkUserBlocked, categoryController.getCategoriesPage)

//profile
router.get('/profile', isAuthenticated, checkUserBlocked, profileController.getProfile);
router.get('/profile/edit', isAuthenticated, checkUserBlocked, profileController.getProfileEdit);
router.put('/api/password', isAuthenticated, checkUserBlocked, profileController.changePassword)
router.post('/api/email/request-change', isAuthenticated, checkUserBlocked, profileController.initiateEmailChange)
router.post('/api/email/verify-change', isAuthenticated, checkUserBlocked, profileController.confirmEmailChange)
router.post('/api/email/resend-otp', isAuthenticated, checkUserBlocked, profileController.resendEmailChangeOtp)
router.put('/api/profile', isAuthenticated, checkUserBlocked, profileController.updateProfile);
router.post('/api/avatar', isAuthenticated, checkUserBlocked, avatarUpload, profileController.uploadAvatar);
router.delete('/api/avatar', isAuthenticated, checkUserBlocked, profileController.removeAvatar);

//addresses
router.get('/addresses', isAuthenticated, checkUserBlocked, addressController.getAddresses)
router.post('/api/address', isAuthenticated, checkUserBlocked, addressController.addAddress);
router.get('/api/address', isAuthenticated, checkUserBlocked, addressController.getUserAddresses);
router.get('/api/address/:id', isAuthenticated, checkUserBlocked, addressController.getAddress);
router.put('/api/address/:id', isAuthenticated, checkUserBlocked, addressController.updateAddress);
router.delete('/api/address/:id', isAuthenticated, checkUserBlocked, addressController.deleteAddress);
router.put('/api/address/:id/default', isAuthenticated, checkUserBlocked, addressController.setDefaultAddress);

//cart
router.get('/cart', isAuthenticated, checkUserBlocked, cartController.renderCart);
router.get('/api/cart', isAuthenticated, checkUserBlocked, cartController.getCart);
router.post('/api/cart', isAuthenticated, checkUserBlocked, cartController.addToCart);
router.put('/api/cart/item/:variantId', isAuthenticated, checkUserBlocked, cartController.updateCartQuantity);
router.delete('/api/cart/item/:variantId', isAuthenticated, checkUserBlocked, cartController.removeFromCart);
router.delete('/api/cart', isAuthenticated, checkUserBlocked, cartController.clearCart);

//checkout order
router.get('/checkout', isAuthenticated, checkUserBlocked, checkoutController.renderCheckout)
router.post('/api/order', isAuthenticated, checkUserBlocked, checkoutController.placeOrder)
router.get('/order-success/:orderId', isAuthenticated, checkUserBlocked, checkoutController.orderSuccess)
router.get('/orders/:orderId', isAuthenticated, checkUserBlocked, orderController.orderDetails)
router.get('/orders/:orderId/invoice', isAuthenticated, checkUserBlocked, orderController.downloadInvoice);
router.get('/orders', isAuthenticated, checkUserBlocked, orderController.orderList)
router.get('/api/orders', isAuthenticated, checkUserBlocked, orderController.getOrders);
router.put('/api/orders/:orderId/cancel', isAuthenticated, checkUserBlocked, orderController.cancelOrder);
router.put('/api/orders/:orderId/items/:itemId/cancel', isAuthenticated, checkUserBlocked, orderController.cancelOrderItem);
router.get('/api/orders/search', isAuthenticated, checkUserBlocked, orderController.searchOrders);
router.post('/api/orders/:orderId/returns', isAuthenticated, checkUserBlocked, orderController.requestReturn);
router.put('/api/orders/:orderId/items/:itemId/return', isAuthenticated, checkUserBlocked, orderController.returnOrderItem);

// Payment failure page routes 
router.get('/payment-failure', isAuthenticated, checkUserBlocked, checkoutController.paymentFailure);
router.post('/payment-failure', isAuthenticated, checkUserBlocked, checkoutController.paymentFailure);

// Payment retry routes
router.post('/api/order/retry-payment/:orderId', isAuthenticated, checkUserBlocked, checkoutController.retryPayment);
router.post('/api/order/verify-retry-payment', isAuthenticated, checkUserBlocked, checkoutController.verifyRetryPayment);
router.post('/api/coupon/apply', isAuthenticated, checkUserBlocked, checkoutController.applyCoupon);
router.post('/api/coupon/remove', isAuthenticated, checkUserBlocked, checkoutController.removeCoupon);
router.post('/api/order/create-payment', isAuthenticated, checkUserBlocked, checkoutController.createPaymentOrder);
router.post('/api/order/verify-payment', isAuthenticated, checkUserBlocked, checkoutController.verifyPayment);
router.post('/api/order/payment-failed', isAuthenticated, checkUserBlocked, checkoutController.createPaymentFailedOrder);
router.post('/api/order/retry-payment/:orderId', isAuthenticated, checkUserBlocked, checkoutController.retryPayment);
router.post('/api/order/verify-retry-payment', isAuthenticated, checkUserBlocked, checkoutController.verifyRetryPayment);

// Wishlist
router.post('/api/wishlist/:variantId', isAuthenticated, checkUserBlocked, wishListController.addToWishlist)
router.delete('/api/wishlist/:variantId', isAuthenticated, checkUserBlocked, wishListController.removeFromWishlist);
router.get('/api/wishlist/:variantId', isAuthenticated, checkUserBlocked, wishListController.checkWishlistStatus);
router.get('/wishlist', isAuthenticated, checkUserBlocked, wishListController.renderWishlistPage)
router.delete('/api/wishlist', isAuthenticated, checkUserBlocked, wishListController.clearWishlist)
router.get('/api/wishlist', isAuthenticated, checkUserBlocked, wishListController.getWishlist);

// Wallet
router.get('/wallet', isAuthenticated, checkUserBlocked, walletController.renderWallet);
router.get('/api/wallet/balance', isAuthenticated, checkUserBlocked, walletController.getWalletBalance);
router.post('/api/wallet/apply-referral', isAuthenticated, checkUserBlocked, walletController.applyReferralCode);

// Logout route
router.get('/logout', isAuthenticated, userController.logout);

module.exports = router;