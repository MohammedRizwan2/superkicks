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

    const userAvatar = user.avatar?.url;
    if(!userAvatar){
        console.log("user avatar not found");
    }

    const cartCount = await Cart.countDocuments({userId});

    const wish  = await wishList.aggregate([
        {$match:{userId:userId}},
        {$project:{count:{$size:"$items"}}}

    ])

    wishCount = wish[0].count;

    res.locals.wishCount = wishCount? wishCount:0;
    res.locals.cartCount = cartCount? cartCount:0;
    res.locals.avatarUrl = userAvatar? userAvatar:"";
    next();
   }
   catch(err){
    next(err)
   } 

}