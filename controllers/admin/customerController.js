const User = require('../../models/User');

// routes/admin.js or your relevant file


exports.getUsers = async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1; // current page number, default 1
    const limit = 10; // number of customers per page

    const filter = { role: "user" };

    if (query) {
      filter.$or = [
        { fullName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ];
    }

    // Count total documents matching the filter
    const totalCustomers = await User.countDocuments(filter);

    // Calculate total pages
    const totalPages = Math.ceil(totalCustomers / limit);

    // Fetch paginated results sorted by creation date descending (latest first)
    const customers = await User.find(filter)
      .sort({ createdAt: -1 }) // descending order by createdAt field; adjust if your timestamp field is different
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
   console.log("Requested ID:", req.params.id);

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