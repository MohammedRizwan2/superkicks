const Product = require('../../models/product');
const Category = require('../../models/category');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Variant = require('../../models/variant');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);
const { uploadBufferToCloudinary } = require('../../helper/cloudinaryUploadHelper');





exports.getProducts = async (req, res) => {
  try {
    const productJustAdded = req.session.productAdded?req.session.productAdded:false;
   
    delete req.session.productAdded;
    const productJustEditted = req.session.productEddited?req.session.productEddited:false;
  
    delete req.session.productEddited;
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
      totalPages,
      productJustEditted,
      productJustAdded
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};






exports.getAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({ isListed: true }).sort({ name: 1 }); 
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







exports.postAddProduct = async (req, res) => {
  
  const { productName, description, brand, categoryId, offer, isListed } = req.body;
  let { variants } = req.body;
  console.log("variants--->",variants);
  let errors = [];

  if (variants && !Array.isArray(variants)) {
    if (typeof variants === 'object' && variants !== null) {
      variants = [variants];
    } else {
      variants = [];
    }
  }

 
  if (!productName || !productName.trim()) errors.push('Product name is required.');
  if (!brand || !brand.trim()) errors.push('Brand is required.');
  if (!categoryId) errors.push('Category is required.');
  if (!description || !description.trim()) errors.push('Description is required.');
  
  if (!req.files || req.files.length < 3) {
  errors.push('Please upload at least 3 images.');
}

  
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
   
const images = Array.isArray(req.files) ? req.files : (req.files ? [req.files] : []);
console.log(images, "----> images array");

const uploads = await Promise.all(
  images.map(file =>
    uploadBufferToCloudinary(file.buffer, 'superkicks/products') 
  )
);

const imagePaths = uploads.map(u => ({
  url: u.secure_url,
  publicId: u.public_id
}));


    const product = new Product({
      productName: productName.trim(),
      description: description.trim(),
      brand: brand.trim().toUpperCase(),
      categoryId,
      offer: offer ? Number(offer) : 0,
      images: imagePaths,
      isListed: true,
      variants: [],
    });
    await product.save();

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
    
    
    product.variants = createdVariants;
    await product.save();

  await product.calculateAndUpdatePrices();
  req.session.productAdded = true;
  req.session.save((err)=>{
    if(err){
      console.log("server error while add product",err)
    }
    console.log("addProduct session saved")
  })
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
    const {
      productName,
      brand,
      categoryId,
      description,
      offer,
      isListed,
      deletedImages = '[]',
      newImages = '[]',
      variants = '[]',
      deletedVariants = '[]'   
    } = req.body;

  
    const parsedDeletedImages = JSON.parse(deletedImages);
    const parsedNewImages = Array.isArray(newImages) ? newImages : JSON.parse(newImages);
  

    const currentProduct = await Product.findById(id);
    if (!currentProduct) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    
    let finalImages = currentProduct.images.filter(img => {
      if (typeof img === 'string') {
        return !parsedDeletedImages.includes(img);
      } else {
        return !parsedDeletedImages.includes(img.publicId) &&
               !parsedDeletedImages.includes(img.url);
      }
    });

    
    if (req.files && req.files.length > 0) {
      const uploads = await Promise.all(
        req.files.map(file => uploadBufferToCloudinary(file.buffer, 'superkicks/products'))
      );
      const uploadedImages = uploads.map(u => ({
        url: u.secure_url,
        publicId: u.public_id
      }));
      finalImages = [...finalImages, ...uploadedImages];
    }

  
    if (parsedNewImages.length > 0) {
      finalImages = [...finalImages, ...parsedNewImages];
    }

    if (finalImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required'
      });
    }

    
    await Promise.all(
      parsedDeletedImages.map(async identifier => {
        if (!identifier) return;
        if (identifier.startsWith('/uploads/')) {
          const filename = identifier.split('/').pop();
          const filepath = path.join(__dirname, '../../public/uploads/products', filename);
          if (fs.existsSync(filepath)) {
            await unlinkAsync(filepath);
          }
        } else {
          try {
            await cloudinary.uploader.destroy(identifier);
          } catch (err) {
            console.error('Cloudinary delete failed:', identifier, err.message);
          }
        }
      })
    );

    let parsedVariants, parsedDeletedVariants;
    try {
      parsedVariants = Array.isArray(variants) ? variants : JSON.parse(variants);
      parsedDeletedVariants = Array.isArray(deletedVariants) ? deletedVariants : JSON.parse(deletedVariants);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON for variants',
        errors: ['Variants data is malformed']
      });
    }

    const errors = [];


    if (!productName  || !productName.trim()) errors.push('Product name is required.');
    if (!brand        || !brand.trim())       errors.push('Brand is required.');
    if (!categoryId)                       errors.push('Category is required.');
    if (!description  || !description.trim()) errors.push('Description is required.');

    
    if (offer !== '' && offer != null) {
      const numOffer = Number(offer);
      if (isNaN(numOffer)) errors.push('Offer must be a number.');
      else if (numOffer < 0 || numOffer > 100) errors.push('Offer must be between 0 and 100.');
    }

    
    if (!Array.isArray(parsedVariants) || parsedVariants.length === 0) {
      errors.push('At least one variant is required.');
    } else {
      parsedVariants.forEach((v, i) => {
        if (!v.size || !v.size.trim()) errors.push(`Variant ${i+1}: Size is required.`);
        if (v.price == null || v.price === '' || isNaN(v.price) || v.price < 0)errors.push(`Variant ${i+1}: Price must be a non-negative number.`);
        if (v.stock != null && (isNaN(v.stock) || v.stock < 0)) errors.push(`Variant ${i+1}: Stock must be a non-negative number.`);
      });
    }

    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors
      });
    }

    
    if (parsedDeletedVariants.length > 0) {
      await Variant.deleteMany({ 
        _id: { $in: parsedDeletedVariants }, 
        productId: id 
      });
    }

    
    const finalVariantIds = [];
    for (const v of parsedVariants) {
      if (v._id) {
        await Variant.findByIdAndUpdate(v._id, {
          size: v.size.trim(),
          regularPrice: Number(v.price),
          stock: v.stock ? Number(v.stock) : 0,
          isListed: true
        });
        finalVariantIds.push(v._id);
      } else {
        const newVar = new Variant({
          productId: id,
          size: v.size.trim(),
          regularPrice: Number(v.price),
          stock: v.stock ? Number(v.stock) : 0,
          isListed: true
        });
        await newVar.save();
        finalVariantIds.push(newVar._id);
      }
    }

    
    const updateData = {
      productName: productName.trim(),
      brand: brand.trim().toUpperCase(),
      categoryId,
      description: description.trim(),
      offer: Math.min(100, Math.max(0, Number(offer)) || 0),
      isListed: isListed === 'true',
      images: finalImages,
      variants: finalVariantIds  
    };

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, { new: true });
    await updatedProduct.calculateAndUpdatePrices();
    req.session.productEdited = true;
    req.session.save(err => {
      if (err) console.error("Error saving session:", err);
    });

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

  
    const result = await uploadBufferToCloudinary(req.file.buffer, 'superkicks/products');

    res.json({
      url: result.secure_url,
      publicId: result.public_id
    });

  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
};