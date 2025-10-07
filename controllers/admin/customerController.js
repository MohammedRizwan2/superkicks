const User = require('../../models/userSchema');
const { HTTP_STATUS, MESSAGES } = require('../../config/constant'); 

exports.getUsers = async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1; 
    const limit = 10; 

    const filter = { role: "user" };

    if (query) {
      filter.$or = [
        { fullName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ];
    }

    const totalCustomers = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalCustomers / limit);

    const customers = await User.find(filter)
      .sort({ createdAt: -1 }) 
      .skip((page - 1) * limit)
      .limit(limit);

    res.render('admin/customer', {
      customers,
      query,
      currentPage: page,
      totalPages,
    });
  } catch (err) {
    console.error(err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).render('error/500', { 
      title: MESSAGES.INTERNAL_ERROR 
    });
  }
};

exports.toggleBlockStatus = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).render('error/404', { 
        title: MESSAGES.NOT_FOUND 
      });
    }

    user.isBlocked = !user.isBlocked;
    await user.save();

    res.redirect('/admin/customers');
  } catch (error) {
    console.error(error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).render('error/500', { 
      title: MESSAGES.INTERNAL_ERROR 
    });
  }
};