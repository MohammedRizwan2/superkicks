const mongoose = require(mongoose);


const couponSchema = new mongoose.Schema({
  couponCode: { type: String, required: true, unique: true },
  couponPercent: { type: Number, required: true, min: 0, max: 100 },
  couponType: { type: String, required: true }, // e.g., 'percentage', 'fixed'
  usageLimit: { type: Number, required: true, min: 1 },
  startingDate: { type: Date, required: true },
  expiryDate: { type: Date, required: true },
  description: { type: String, required: true },
  minAmount: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const Coupon = mongoose.model('Coupon', couponSchema);