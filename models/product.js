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

const Product = mongoose.model('Product', productSchema);

module.exports = Product;