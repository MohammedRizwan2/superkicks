const Product = require('../../models/product');
const Category = require('../../models/category');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Variant = require('../../models/variant');
const { promisify } = require('util');
const { uploadProductImages } = require('../../config/multer');
const unlinkAsync = promisify(fs.unlink);






exports.getProducts = async (req, res) => {
  try {
    
    const query = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = 5; 

    
    const filter = {};
    if (query) {
      filter.$or = [
        { productName: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } }
      ];
    }

    
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / limit);

    
    const products = await Product.find(filter)
      .sort({ createdAt: -1 }) 
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('categoryId', 'name') 
      .populate('variants');          

    
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






exports.getAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({ isListed: true }).sort({ name: 1 }); // Only show listed/active categories, sorted by name (optional)
    res.render('admin/addproduct', {
      categories,
      errors: [],
      old: {} 
    });
  } catch (error) {
    console.error('Error loading add product page:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};



// Helper function to save image blobs
// Helper function to save uploaded image files (buffers)
async function saveImageFiles(files, destFolder) {
  if (!fs.existsSync(destFolder)) {
    fs.mkdirSync(destFolder, { recursive: true });
  }

  const imagePaths = [];
  for (const file of files) {
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const filepath = path.join(destFolder, filename);

    // Write the buffer to disk
    await fs.promises.writeFile(file.path,filepath);
    imagePaths.push(`/uploads/products/${filename}`);
  }


  return imagePaths;
}


exports.postAddProduct = async (req, res) => {
  
  const { productName, description, brand, categoryId, offer, isListed } = req.body;
  let { variants } = req.body;
  console.log("variants--->",variants);
  let errors = [];

  // Convert variants to array if it's not
  if (variants && !Array.isArray(variants)) {
    if (typeof variants === 'object' && variants !== null) {
      variants = [variants];
    } else {
      variants = [];
    }
  }

  // Basic validation
  if (!productName || !productName.trim()) errors.push('Product name is required.');
  if (!brand || !brand.trim()) errors.push('Brand is required.');
  if (!categoryId) errors.push('Category is required.');
  if (!description || !description.trim()) errors.push('Description is required.');
  
  if (!req.files || req.files.length < 3) {
  errors.push('Please upload at least 3 images.');
}

  // Rest of your validation and logic remains the same...
  if (!variants || variants.length === 0 || !variants.some(v => v.size && v.price)) {
    errors.push('At least one variant (with size & price) is required.');
  } else {
    variants.forEach((v, i) => {
      if (!v.size || !v.size.trim()) {
        errors.push(`Variant ${i+1}: Size is required.`);
      }
      if (!v.price || isNaN(v.price) || v.price < 0) {
        errors.push(`Variant ${i+1}: Price must be a positive number.`);
      }
      if (v.stock && (isNaN(v.stock) || v.stock < 0)) {
        errors.push(`Variant ${i+1}: Stock must be a positive number.`);
      }
    });
  }

  // Offer validation
  if (offer !== '' && offer !== undefined && offer !== null) {
    const numOffer = Number(offer);
    if (isNaN(numOffer)) {
      errors.push("Offer must be a number.");
    } else if (numOffer < 0 || numOffer > 100) {
      errors.push("Offer must be between 0 and 100.");
    }
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
   const images = Array.isArray(req.files) ? req.files : [req.files];
   console.log(images,"----> images array")
const imagePaths = await saveImageFiles(images, path.join(__dirname, '../../public/uploads/products'));
console.log(imagePaths,"---->images paths")

    // Create product
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

    // Create variants
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

    console.log("variants-->",createdVariants)
    
    // Update product with variant IDs
    product.variants = createdVariants;
    await product.save();

    res.redirect('/admin/products');
  } catch (error) {
    console.error('Error adding product:', error);
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
      .populate('variants'); 

    if (!product) {
      return res.status(404).render('error/404', { title: 'Product Not Found' });
    }

    const categories = await Category.find({ isListed: true }).sort({ name: 1 });
console.log(product.categoryId);
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
  try {
    const { id } = req.params;
    console.log(req.body,"--->files");
    const {
      productName,
      brand,
      categoryId,
      description,
      offer,
      isListed,
      deletedImages = "[]",
      newImages,
      variants
    } = req.body;

    // Parse deleted images
    const parsedDeletedImages = JSON.parse(deletedImages);
    
    // Get current product
    const currentProduct = await Product.findById(id);
    if (!currentProduct) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Process images - keep existing except deleted ones
    let finalImages = currentProduct.images.filter(img => !parsedDeletedImages.includes(img));
//uploadProductImages
    // Add new uploaded images
    if (newImages && newImages.length > 0) {
      // const newImagePaths = req.files.map(file => 
      //   `/uploads/products/${file.filename}`
      // );
      finalImages = [...finalImages, ...newImages];
    }

    // Validate we have at least one image
    if (finalImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required'
      });
    }
     if (req.query.action === 'upload-image') {
      if (!req.file) throw new Error('No file uploaded');
      return res.json({
        url: `/uploads/products/${req.file.filename}`
      });
    }

    // Clean up deleted images from server
    await Promise.all(
      parsedDeletedImages.map(async (imgUrl) => {
        if (!imgUrl) return;
        const filename = imgUrl.split('/').pop();
        const filepath = path.join(__dirname, '../../public/uploads/products', filename);
        if (fs.existsSync(filepath)) {
          await unlinkAsync(filepath);
        }
      })
    );

    // Rest of your update logic...
    const updateData = {
      productName: productName.trim(),
      brand: brand.trim(),
      categoryId,
      description: description.trim(),
      offer: Math.min(100, Math.max(0, Number(offer)) || 0),
      isListed: isListed === 'true',
      images: finalImages
    };
console.log(updateData.images,">>>>>>>")
    // Update product and variants...
    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, { new: true });
    
    return res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });

  } catch (error) {
    console.error('Edit product error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the product'
    });
  }
};



exports.uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return the image URL
    res.json({
      url: `/uploads/products/${req.file.filename}`
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
};