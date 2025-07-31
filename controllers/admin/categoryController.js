

const Category = require('../../models/category'); 

exports.getCategories = async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;

    const filter = {};
    if (query) {
      filter.name = { $regex: query, $options: 'i' };
    }

    // Count total documents for pagination
    const totalCategories = await Category.countDocuments(filter);
    const totalPages = Math.ceil(totalCategories / limit);
    
    // Fetch categories sorted by latest first. Use 'createdAt' or '_id' depending on your schema.
    const categories = await Category.find(filter)
      .sort({ createdAt: -1 }) // or { _id: -1 } if you don't use timestamps
      .skip((page - 1) * limit)
      .limit(limit);

    res.render('admin/category', {
      categories,
      query,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    console.error(err);
    res.render('error/500', { title: 'Server Error' });
  }
};


exports.getAddCategory = async(req,res)=>{
   res.render('admin/addcategory',{ errors: [], old: {} }) 
}





exports.postAddCategory = async (req, res) => {
  const { name, description, offer, isListed } = req.body;
  let errors = [];


  if (!name || !name.trim()) {
    errors.push("Category name is required.");
  }
  if (offer !== undefined && offer !== '') {
    const offerNum = Number(offer);
    if (isNaN(offerNum) || offerNum < 0 || offerNum > 100) {
      errors.push("Offer must be a number between 0 and 100.");
    }
  }

  // If errors, re-render with old data
  if (errors.length > 0) {
    return res.render('admin/addcategory', {
      errors,
      old: req.body
    });
  }

  try {
   
    const categoryExists = await Category.findOne({ name: name.trim() });
    if (categoryExists) {
      return res.render('admin/addcategory', {
        errors: ['A category with this name already exists.'],
        old: req.body
      });
    }

    // Prepare data
    const categoryData = {
      name: name.trim(),
      description: description || '',
      offer: offer ? Number(offer) : 0,
      isListed: isListed === 'on' ? true : false
    };

    // Create and save the new category
    await Category.create(categoryData);

    // Redirect or show SweetAlert in response if using flash messages
    res.redirect('/admin/category');
  } catch (error) {
    console.error(error);
    res.render('admin/addcategory', {
      errors: ['Server error, please try again later.'],
      old: req.body
    });
  }
};





exports.getEditCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      // Handle category not found (could also redirect with a flash error)
      return res.status(404).render('error/404', { title: 'Category Not Found' });
    }
    res.render('admin/editcategory', { category, errors: [], old: {} });
  } catch (error) {
    console.error(error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};


// You can put this validateCategoryInput in a separate file if you want.
function validateCategoryInput({ name, offer }) {
  let errors = [];
  if (!name || !name.trim()) errors.push("Category name is required.");
  if (offer !== undefined && offer !== '') {
    const offerNum = Number(offer);
    if (isNaN(offerNum) || offerNum < 0 || offerNum > 100)
      errors.push("Offer must be a number between 0 and 100.");
  }
  return errors;
}

exports.postEditCategory = async (req, res) => {
  const { name, description, offer, isListed } = req.body;
  const categoryId = req.params.id;

  // Validate input
  const errors = validateCategoryInput({ name, offer });

  if (errors.length > 0) {
    // Reload edit page with errors and previous input
    const category = await Category.findById(categoryId);
    return res.render('admin/editcategory', {
      category,
      errors,
      old: req.body
    });
  }

  try {
    // Check for duplicate name (but allow if it is the current category)
    const duplicate = await Category.findOne({ 
      name: name.trim(), 
      _id: { $ne: categoryId } 
    });
    if (duplicate) {
      const category = await Category.findById(categoryId);
      return res.render('admin/editcategory', {
        category,
        errors: ["A category with this name already exists."],
        old: req.body
      });
    }

    // Prepare update fields
    const updatedFields = {
      name: name.trim(),
      description: description || '',
      offer: offer ? Number(offer) : 0,
      isListed: isListed === 'on'
    };

    // Update the category
    await Category.findByIdAndUpdate(categoryId, updatedFields, { new: true });

    return res.redirect('/admin/category');
  } catch (error) {
    console.error(error);
    const category = await Category.findById(categoryId);
    res.render('admin/editcategory', {
      category,
      errors: ['Server error, please try again later.'],
      old: req.body
    });
  }
};
