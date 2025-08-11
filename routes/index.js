const express = require('express');
const router = express.Router();
const Product= require('../models/product')
const Category = require('../models/category')
const User = require('../models/userSchema');
const product = require('../models/product');

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


    const products = await Product.aggregate([
      {$match:{isListed:true}},
      {
        $lookup:{
          from:'categories',
          localField:'categoryId',
          foreignField:'_id',
          as:'categoryInfo'

        }
      }
      ,{$unwind:{path:'$categoryInfo',preserveNullAndEmptyArrays:true}},
      {$match:{'categoryInfo.isListed':true}},
      {$sort:{'createdAt':-1}},

      
      {$lookup:{
        from:'variants',
        localField:'variants',
        foreignField:'_id',
        as:'variantDoc'

      }},

      {$addFields:{
    
          bestOffer: {
            $max: [
              { $ifNull: ["$offer", 0] },
              { $ifNull: ["$categoryInfo.offer", 0] }
            ]
          },
        
          lowestPrice: { $min: "$variantDoc.regularPrice" },
    
          lowestSalePrice: { $min: "$variantDoc.salePrice" }
      }}


    ])

    // Prepare login state from the session
    const user = req.session && req.session.user ? req.session.user : null;
    const isLoggedIn = !!user;
    const justLoggedIn= !!req.session.justLoggedIn;
    delete req.session.justLoggedIn;
    res.render('home', {
      categories,
      products,
      user,
      isLoggedIn,
      justLoggedIn
    });
  } catch (error) {
    console.error('Error loading home page:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
});

module.exports = router;