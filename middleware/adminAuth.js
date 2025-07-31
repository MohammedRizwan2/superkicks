
module.exports = function adminAuth(req, res, next) {
  if (req.session && req.session.user&& req.session.user.role=='admin') {
    return next();
  }

  res.redirect('/admin/login');
};





