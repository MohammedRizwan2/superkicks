const User = require('../models/userSchema')

 exports.checkUserBlocked=  async function(req, res, next) {
  try {
    
    if (req.session && req.session.user) {
    const email = req.session.user.email;
      const user = await User.findOne({ email });

      if (!user || user.isBlocked) {
    
        req.session.user = null;
    
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
