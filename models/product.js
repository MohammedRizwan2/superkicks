const mongoose = require('mongoose');


const productSchema = new mongoose.Schema({
  productName: { type: String, required: true },
  description: { type: String, required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  brand: { type: String, required: true },
  offer: { type: Number, default: 0, min: 0, max: 100 },
  images: [{ type: String, required: true }],
  isListed: { type: Boolean, default: true },


   variants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }],

}, { timestamps: true });


productSchema.pre('save', async function(next) {
  if (this.isModified('offer')) {
    const Variant = mongoose.model('Variant');
    
    // First get all variants with their regular prices
    const variants = await Variant.find({ _id: { $in: this.variants } });
    
    // Calculate new sale prices
    const updateOperations = variants.map(variant => {
      const effectiveDiscount = this.category 
        ? this.category.getEffectiveDiscount(this.offer)
        : this.offer;
      
      const salePrice = effectiveDiscount > 0
        ? variant.regularPrice * (1 - (effectiveDiscount / 100))
        : null;
      
      return {
        updateOne: {
          filter: { _id: variant._id },
          update: { $set: { salePrice } }
        }
      };
    });
    
    // Bulk write the updates
    if (updateOperations.length > 0) {
      await Variant.bulkWrite(updateOperations);
    }
  }
  next();
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;