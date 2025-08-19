const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productName: { type: String, required: true },
  description: { type: String, required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  brand: { type: String, required: true },
  offer: { type: Number, default: 0, min: 0, max: 100 },
    images: {
    type: [mongoose.Schema.Types.Mixed], 
    required: true
  },

  isListed: { type: Boolean, default: true },
  variants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }]
}, { timestamps: true });


productSchema.methods.updateVariantPrices = async function() {
  const product = this.populated('categoryId') || await this.populate('categoryId');
  const Variant = mongoose.model('Variant');
  
  const variants = await Variant.find({ productId: product._id });
  
  await Promise.all(
    variants.map(async variant => {
      const effectiveDiscount = product.categoryId?.getEffectiveDiscount?.(product.offer) || product.offer;
      const salePrice = parseFloat(
        (variant.regularPrice * (1 - (Math.min(effectiveDiscount, 100) / 100))).toFixed(2)
      );
      
      if (variant.salePrice !== salePrice) {
        variant.salePrice = salePrice;
        await variant.save();
      }
    })
  );
};

productSchema.pre('save', async function(next) {
  if (this.variants?.length > 0 || this.isModified("offer")) {
    try {
      await this.updateVariantPrices();
    } catch (err) {
      console.error('Variant price update failed:', err);
    }
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);