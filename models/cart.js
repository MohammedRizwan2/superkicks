
const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', 
    required: true 
  },
  variantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Variant', 
    required: true 
  },
  quantity: { 
    type: Number, 
    required: true, 
    min: 1 
  }
 
   
}, { _id: false });

const cartSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  items: [cartItemSchema],
}, { timestamps: true });

// Export the model directly
module.exports = mongoose.model('Cart', cartSchema);