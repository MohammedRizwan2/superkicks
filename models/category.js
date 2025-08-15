const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true, 
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  offer: {
  type: Number,
  default: 0,
  min: 0,
  max: 100
},
  isListed: {
    type: Boolean,
    default: true 
  }
}, {
  timestamps: true 
});




// categoryModel.js
categorySchema.methods.getEffectiveDiscount = function(productOffer = 0) {
  return Math.max(this.offer, productOffer); // Returns the higher discount
};
categorySchema.post('findOneAndUpdate', async function(category) {
  const Product = mongoose.model('Product');
  const Variant = mongoose.model('Variant');
  
  // Find all products in this category with their variants
  const products = await Product.find({ categoryId: category._id }).populate('variants');
  
  // Prepare bulk write operations
  const bulkOps = [];
  
  for (const product of products) {
    const effectiveDiscount = category.getEffectiveDiscount(product.offer);
    
    // Get all variants for this product
    const variants = await Variant.find({ _id: { $in: product.variants } });
    
    variants.forEach(variant => {
      const salePrice = effectiveDiscount > 0
        ? variant.regularPrice * (1 - (effectiveDiscount / 100))
        : null;
      
      bulkOps.push({
        updateOne: {
          filter: { _id: variant._id },
          update: { $set: { salePrice } }
        }
      });
    });
  }
  
  // Execute all updates in a single operation
  if (bulkOps.length > 0) {
    await Variant.bulkWrite(bulkOps);
  }
});
module.exports = mongoose.model('Category', categorySchema);
