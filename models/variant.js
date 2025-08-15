const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', 
    required: true 
  },
  size: { 
    type: Number, 
    required: true 
  },
  regularPrice: { 
    type: Number, 
    required: true, 
    min: 0 
  },
  salePrice: { 
    type: Number,  
    min: 0,
    default: function() {
      return this.regularPrice; // Default to regular price
    }
  },
  stock: { 
    type: Number, 
    required: true, 
    min: 0 
  }
}, { timestamps: true });

const Variant = mongoose.model('Variant', variantSchema);
module.exports = Variant;