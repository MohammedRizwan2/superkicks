const express = require('express');
const router = express.Router();
const Product= require('../models/product')
const Category = require('../models/category')
const User = require('../models/userSchema')

// Middleware to check if user is blocked
async function checkUserBlocked(req, res, next) {
  try {
    console.log("heeee")
    

    if (req.session && req.session.user) {
    const email = req.session.user.email;
      const user = await User.findOne({ email });

      if (!user || user.isBlocked) {
        // Clear only user session data
        req.session.user = null;
        // Render login with message or redirect
        return res.render('user/login', {
          message: "Your account has been blocked by admin.",
          isError: true,
          oldInput: {}
        });
      }
    }
    next();
  } catch (error) {
    console.error('Error in checkUserBlocked middleware:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
}


router.get('/',checkUserBlocked, async (req, res) => {
  try {
    // Fetch up to 4 listed categories
    const categories = await Category.find({ isListed: true })
      .sort({ createdAt: -1 })
      .limit(4);

    // Fetch up to 4 listed products, including variants for price display
    const products = await Product.find({ isListed: true })
      .sort({ createdAt: -1 })
      .limit(4)
      .populate('variants');

    // Prepare login state from the session
    const user = req.session && req.session.user ? req.session.user : null;
    const isLoggedIn = !!user;

    res.render('home', {
      categories,
      products,
      user,
      isLoggedIn
    });
  } catch (error) {
    console.error('Error loading home page:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
});

module.exports = router;