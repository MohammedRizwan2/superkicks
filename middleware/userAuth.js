// // check if user is blocked 



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
        res.redirect('/login?blocked=1');
      });
      return;
    }

    // User is fine, proceed
    next();
  } catch (err) {
    console.error('Session validation error:', err);
    // In case of error, forcibly logout to be safe
    req.session.destroy(() => {
      res.redirect('/login');
    });
  }
}

module.exports = userIsNotBlocked;


