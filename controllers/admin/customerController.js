const User = require('../../models/userSchema');




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
    res.render('error/500', { title: "Server Error" });
  }
};

exports.toggleBlockStatus = async (req, res) => {
  try {
   

    const userId = req.params.id;

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).send('User not found');
    }

    
    user.isBlocked = !user.isBlocked;

    
    await user.save();

   
    res.redirect('/admin/customers');
  } catch (error) {
    console.error(error);
    res.render('error/500', { title: "Server Error" });
  }
};