const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productName: { type: String, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  status: { type: String, required: true },
  cancellationReason: { type: String },
  returnReason: { type: String },
  returnRequestDate: { type: Date },
  isReturned: { type: Boolean, default: false },
  isCancelled: { type: Boolean, default: false },
  
  
  returnRequested: { type: Boolean, default: false }, 
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order',  },
  returnApproved: { type: Boolean }, 
  returnRejectionReason: { type: String }, 
  returnProcessedDate: { type: Date }, 
  statusHistory: [{ 
    status: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: { type: Date, default: Date.now },
    reason: String
  }]

}, { timestamps: true });

module.exports = mongoose.model('OrderItem', orderItemSchema);
