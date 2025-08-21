const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: { 
      type: String, 
      required: [true, 'Full name is required'], 
      trim: true, 
      minlength: [2, 'Full name must be at least 2 characters'],
      maxlength: [50, 'Full name cannot exceed 50 characters'],
    },
    email: { 
      type: String, 
      required: [true, 'Email is required'], 
      unique: true, 
      lowercase: true,           
      trim: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
      index: true,
    },
    password: { 
      type: String, 
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
                   // exclude password by default from queries
    },
    phone: {
      type: String,
      trim: true,
      match: [/^\+?[0-9\s\-]{7,15}$/, 'Please use a valid phone number'], // optional simple phone validation
    },
    avatar:{type:Object},
  dateOfBirth:{type:Date},

    role: { 
      type: String, 
      enum: ['user', 'admin'], 
      default: 'user' 
    },
    isBlocked: { 
      type: Boolean, 
      default: false 
    },

 
  },
  {
    timestamps: true,
  }
);

const user = mongoose.model('User', userSchema);


module.exports =  user;