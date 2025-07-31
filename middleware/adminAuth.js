
module.exports = async function adminAuth(req, res, next) {
  if (req.session.admin) {
    return next();
  }

  res.redirect('/admin/login');
};





