const express = require('express');
const router = express.Router();
const Product= require('../models/product')
const Category = require('../models/category')






router.get('/', async (req, res) => {
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