const mongoose = require('mongoose');


const wishSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{ variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true } }],
}, { timestamps: true });

module.exports=mongoose.model('Wish', wishSchema);
