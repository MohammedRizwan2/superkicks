const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  email: { type: String, required: true, match: /.+\@.+\..+/ },
  phone: { type: String, required: true },
  alternatePhone: { type: String },
  country: { type: String, required: true },
  state: { type: String, required: true },
  address: { type: String, required: true },
  landmark: { type: String },
  pinCode: { type: String, required: true, match: /^[0-9]{5,6}$/ },
  type: { type: String, enum: ['home', 'work', 'other'], required: true }
}, { timestamps: true });

module.exports = mongoose.model('Address', addressSchema);
