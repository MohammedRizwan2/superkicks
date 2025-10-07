// middleware/headerData.js
const User = require('../models/userSchema');
const Cart = require('../models/cart');
const wishList = require('../models/wish');

const headerDataMiddleware = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      res.locals.cartCount = 0;
      res.locals.wishCount = 0;
      res.locals.isLoggedIn = false;
      res.locals.avatar = '/img/default-avatar.jpg';
      res.locals.userName = 'User';
      return next();
    }

    const user = await User.findById(userId);
    const cart = await Cart.findOne({ userId });
    const wish = await wishList.findOne({ userId });

    res.locals.cartCount = cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    res.locals.wishCount = wish?.items?.length || 0;
    res.locals.isLoggedIn = true;
    res.locals.avatar = user?.avatar?.url || '/img/default-avatar.jpg';
    res.locals.userName = user?.fullName || user?.name || 'User';

    next();
  } catch (err) {
    console.error('Header data middleware error:', err);
    res.locals.cartCount = 0;
    res.locals.wishCount = 0;
    res.locals.isLoggedIn = false;
    res.locals.avatar = '/img/default-avatar.jpg';
    res.locals.userName = 'User';
    next();
  }
};

module.exports = headerDataMiddleware;
