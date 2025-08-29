const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  description: { type: String, trim: true, maxlength: 200 },
  type: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
  value: { type: Number, required: true, min: 1 },
  maxDiscount: { type: Number, min: 0, default: 0 }, 
  minOrder: { type: Number, min: 0, default: 0 },
  usageLimit: { type: Number, min: 0, default: 0 }, 
  perUserLimit: { type: Number, min: 0, default: 0 }, // 0 = unlimited
  usedCount: { type: Number, min: 0, default: 0 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

couponSchema.index({ code: 1 }, { unique: true });

couponSchema.pre('validate', function(next) {
  if (this.type === 'PERCENT') {
    if (this.value > 100) {
      return next(new Error('Percentage value cannot exceed 100'));
    }
  }
  if (this.endDate <= this.startDate) {
    return next(new Error('End date must be after start date'));
  }
  next();
});

module.exports = mongoose.model('Coupon', couponSchema);
