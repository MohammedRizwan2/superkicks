const mongoose = require('mongoose');
const User = require('../models/userSchema');
const wishList = require('../models/wish');
const Cart= require('../models/cart');



module.exports = async(req,res,next)=>{
   try{
  const userId = req.session?.user?.id;

    if(!userId){
        console.log("no user id found");
        return res.redirect('/user/login');
    }

    const user =await User.findById(userId);

   const userAvatar = user?.avatar?.url || '/img/default-avatar.jpg';
    if(!userAvatar){
        console.log("user avatar not found");
    }

    const cart = await Cart.find({userId});
    
    const cartCount = cart[0]?.items?.length||0;
  
    
     const wish = await wishList.find({userId})

   
    wishCount = wish[0]?.items.length||0;

    res.locals.wishCount = wishCount;
    res.locals.cartCount = cartCount;
    res.locals.avatar = userAvatar;
    next();
   }
   catch(err){
    next(err)
   } 

}