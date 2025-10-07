const mongoose = require('mongoose');


const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referenceNo: { type: String, required: true, unique: true },
  paymentMethod: { type: String, required: true }, 
  orderDate: { type: Date, default: Date.now },
  status: { type: String, required: true }, //  
  address: {
    name: { type: String, required: true },
    email: { type: String, required: true, match: /.+\@.+\..+/ },
    phone: { type: Number, required: true },
    alternatePhone: { type: Number },
    country: { type: String, required: true },
    state: { type: String, required: true },
    address: { type: String, required: true },
    landmark: { type: String },
    pinCode: { type: String, required: true },
    type: { type: String, required: true },
  },
  transactionId: { type: String },
    coupon: {
    code: { type: String },
    type: { type: String, enum: ['PERCENT', 'FLAT'] },
    value: { type: Number }, 
    discountAmount: { type: Number } 
  },

  razorpayOrderId:String,
  razorpayPaymentId: String,
  razorpaySignature: String,
 tax:{type:Number,min:0},  
total: { type: Number, required: true, min: 0 },
  orderItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true }],
}, { timestamps: true });

module.exports= mongoose.model('Order', orderSchema);