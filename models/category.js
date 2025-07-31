const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true, 
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  offer: {
  type: Number,
  default: 0,
  min: 0,
  max: 100
},
  isListed: {
    type: Boolean,
    default: true 
  }
}, {
  timestamps: true 
});

module.exports = mongoose.model('Category', categorySchema);
