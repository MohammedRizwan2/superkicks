const User = require('../../models/userSchema');
const bcrypt = require('bcryptjs');
const { HTTP_STATUS, MESSAGES } = require('../../config/constant'); 


exports.getAdminLogin = (req, res) => {
  res.render('admin/login');
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  let errorMessage = '';

  try {
    if (!email || !password) {
      errorMessage = MESSAGES.BAD_REQUEST;
      return res.status(HTTP_STATUS.BAD_REQUEST).render('admin/login', { 
        errorMessage, 
        oldInput: { email } 
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      errorMessage = MESSAGES.INVALID_CREDENTIALS;
      return res.status(HTTP_STATUS.UNAUTHORIZED).render('admin/login', { 
        errorMessage, 
        oldInput: { email } 
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      errorMessage = MESSAGES.INVALID_CREDENTIALS;
      return res.status(HTTP_STATUS.UNAUTHORIZED).render('admin/login', { 
        errorMessage, 
        oldInput: { email } 
      });
    }

    if (user.role !== 'admin') {
      errorMessage = MESSAGES.FORBIDDEN;
      return res.status(HTTP_STATUS.FORBIDDEN).render('admin/login', { 
        errorMessage, 
        oldInput: { email } 
      });
    }

    req.session.admin = {
      id: user._id,
      email: user.email,
      role: user.role,  
    };

    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Admin login error:', err);
    errorMessage = MESSAGES.INTERNAL_ERROR;
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).render('admin/login', { 
      errorMessage, 
      oldInput: { email } 
    });
  }
};

exports.logout = (req, res) => {
  try {
    req.session.admin = null;

    req.session.save((err) => {
      if (err) {
        console.error('Error saving session during admin logout:', err);
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).render('error/500', { 
          title: MESSAGES.INTERNAL_ERROR 
        });
      }
      res.redirect('/admin/login');
    });
  } catch (err) {
    console.error('Error in admin logout:', err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).render('error/500', { 
      title: MESSAGES.INTERNAL_ERROR 
    });
  }
};