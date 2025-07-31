const Product = require('../../models/product');
const Category = require('../../models/category');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Variant = require('../../models/variant');




exports.getProducts = async (req, res) => {
  try {
    // Extract query parameters
    const query = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10; // Number of products per page

    // Build filter for search
    const filter = {};
    if (query) {
      filter.$or = [
        { productName: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } }
      ];
    }

    // Count total matching products for pagination
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / limit);

    // Fetch products + populate category and variants, apply sort and paging
    const products = await Product.find(filter)
      .sort({ createdAt: -1 }) // newest first
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('categoryId', 'name') // populate only category name
      .populate('variants');          // populate variant details

    // Render your EJS template with products and paging info
    res.render('admin/products', {
      products,
      query,
      currentPage: page,
      totalPages
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};





// GET: Render Add Product page
exports.getAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({ isListed: true }).sort({ name: 1 }); // Only show listed/active categories, sorted by name (optional)
    res.render('admin/addproduct', {
      categories,
      errors: [],
      old: {} // For form repopulation on error (empty on first load)
    });
  } catch (error) {
    console.error('Error loading add product page:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};






async function processAndSaveImages(files, destFolder) {
  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
  const IMAGE_WIDTH = 800, IMAGE_HEIGHT = 800;
  const imagePaths = [];

  for (const file of files) {
    const filename = `${Date.now()}-${file.originalname.replace(/\s+/g, '')}`;
    const filepath = path.join(destFolder, filename);
    await sharp(file.buffer)
      .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: sharp.fit.cover, position: sharp.strategy.entropy })
      .toFormat('jpeg').jpeg({ quality: 90 })
      .toFile(filepath);
    imagePaths.push(`/uploads/products/${filename}`);
  }
  return imagePaths;
}

exports.postAddProduct = async (req, res) => {
  const { productName, description, brand, categoryId, offer, isListed } = req.body;
  let { variants } = req.body;
  let errors = [];

  // Flatten variants if user enters just one variant row
  if (variants && !Array.isArray(variants)) variants = [variants];

  // --- VALIDATION ---
  if (!productName || !productName.trim()) errors.push('Product name is required.');
  if (!brand || !brand.trim()) errors.push('Brand is required.');
  if (!categoryId) errors.push('Category is required.');
  if (!description || !description.trim()) errors.push('Description is required.');
  if (!req.files || req.files.length < 3) errors.push('Please upload at least 3 images.');

  // Validate variants (min one)
  if (!variants || variants.length === 0 || !variants.some(v => v.size && v.price))
    errors.push('At least one variant (with size & price) is required.');
  else {
    variants.forEach((v, i) => {
      if (!v.size || !v.size.trim())
        errors.push(`Variant ${i+1}: Size is required.`);
      if (!v.price || isNaN(v.price) || v.price < 0)
        errors.push(`Variant ${i+1}: Price must be a positive number.`);
    });
  }

  if (offer !== '' && offer !== undefined && offer !== null) {
    const numOffer = Number(offer);
    if (isNaN(numOffer) || numOffer < 0 || numOffer > 100)
      errors.push("Offer must be a number between 0 and 100.");
  }

  if (errors.length > 0) {
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });
    return res.render('admin/addproduct', {
      categories,
      errors,
      old: { ...req.body, variants }
    });
  }

  try {
    // Process images
    const imagePaths = await processAndSaveImages(req.files, path.join(__dirname, '../../public/uploads/products'));

    // Create product (variants filled after variant docs are made)
    const product = new Product({
      productName: productName.trim(),
      description: description.trim(),
      brand: brand.trim(),
      categoryId,
      offer: offer ? Number(offer) : 0,
      images: imagePaths,
      isListed: isListed === 'on',
      variants: [],
    });
    await product.save();

    // Create & link variants (each linked to product)
    const createdVariants = [];
    for (const v of variants) {
      const variantDoc = new Variant({
        productId: product._id,
        size: v.size,
        regularPrice: Number(v.price),
        stock: v.stock ? Number(v.stock) : 0,
        isListed: true,
      });
      await variantDoc.save();
      createdVariants.push(variantDoc._id);
    }
    // Link created variants to product, then save
    product.variants = createdVariants;
    await product.save();

    res.redirect('/admin/products');
  } catch (error) {
    console.error(error);
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });
    res.render('admin/addproduct', {
      categories,
      errors: ['Server error, please try again.'],
      old: req.body
    });
  }
};







exports.getEditProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('categoryId', 'name')
      .populate('variants'); // Get all variant info

    if (!product) {
      return res.status(404).render('error/404', { title: 'Product Not Found' });
    }

    const categories = await Category.find({ isListed: true }).sort({ name: 1 });

    res.render('admin/editproduct', {
      product,
      categories,
      errors: [],
      old: {},
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};







exports.postEditProduct = async (req, res) => {
  const { productName, brand, categoryId, description, offer, isListed } = req.body;
  let { variants } = req.body;
  let errors = [];

  // Normalize variants for single/multiple
  if (variants && !Array.isArray(variants)) variants = [variants];

  // --- VALIDATION ---
  if (!productName || !productName.trim()) errors.push('Product name is required.');
  if (!brand || !brand.trim()) errors.push('Brand is required.');
  if (!categoryId) errors.push('Category is required.');
  if (!description || !description.trim()) errors.push('Description is required.');

  // Validate offer
  if (offer !== '' && offer !== undefined && offer !== null) {
    const numOffer = Number(offer);
    if (isNaN(numOffer) || numOffer < 0 || numOffer > 100)
      errors.push("Offer must be a number between 0 and 100.");
  }

  // Validate variants
  if (!variants || variants.length === 0 || !variants.some(v => v.size && v.price))
    errors.push('At least one variant (with size & price) is required.');
  else {
    variants.forEach((v, i) => {
      if (!v.size || !v.size.trim())
        errors.push(`Variant ${i+1}: Size is required.`);
      if (!v.price || isNaN(v.price) || v.price < 0)
        errors.push(`Variant ${i+1}: Price must be a positive number.`);
    });
  }

  // If user is replacing images, require at least 3
  const uploadingNewImages = req.files && req.files.length > 0;
  if (uploadingNewImages && req.files.length < 3) {
    errors.push('Please upload at least 3 images if replacing product images.');
  }

  // If validation fails, re-render with entered data
  if (errors.length > 0) {
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });
    const product = await Product.findById(req.params.id)
      .populate('categoryId', 'name')
      .populate('variants');
    return res.render('admin/editproduct', {
      product,
      categories,
      errors,
      old: { ...req.body, variants }
    });
  }

  try {
    // --- Update images if new ones were uploaded ---
    let imagePaths = undefined;
    if (uploadingNewImages) {
      imagePaths = await processAndSaveImages(req.files, path.join(__dirname, '../public/uploads/products'));
    }

    // --- Update product (all updatable fields) ---
    const updateFields = {
      productName: productName.trim(),
      brand: brand.trim(),
      categoryId,
      description: description.trim(),
      offer: offer ? Number(offer) : 0,
      isListed: isListed === 'on',
    };
    if (imagePaths) updateFields.images = imagePaths;

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true }
    );

    // --- Update variants ---
    // For simplicity, we'll delete all old variants and add new ones from form.
    // Alternative: update existing ones by _id if your form sends them.
    await Variant.deleteMany({ productId: product._id });

    const newVariantIds = [];
    for (const v of variants) {
      const variantDoc = new Variant({
        productId: product._id,
        size: v.size,
        regularPrice: Number(v.price),
        stock: v.stock ? Number(v.stock) : 0,
        isListed: true,
      });
      await variantDoc.save();
      newVariantIds.push(variantDoc._id);
    }
    product.variants = newVariantIds;
    await product.save();

    res.redirect('/admin/products');
  } catch (error) {
    console.error(error);
    const product = await Product.findById(req.params.id)
      .populate('categoryId', 'name')
      .populate('variants');
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });
    res.render('admin/editproduct', {
      product,
      categories,
      errors: ['Server error, please try again.'],
      old: { ...req.body, variants }
    });
  }
};
