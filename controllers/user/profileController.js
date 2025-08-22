const mongoose = require('mongoose')
const User = require('../../models/userSchema');
const Address = require('../../models/address');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs')
const nodemailer = require('nodemailer');
const cloudinary = require('../../config/cloudinary');
const Order = require('../../models/order')
const wishList = require('../../models/wish')


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODEMAILER_EMAIL,
    pass: process.env.NODEMAILER_PASS,
  },
});

//get profile 
exports.getProfile = async (req,res)=>{
    if(!req.session){
        console.log("session not found")
        res.redirect('/user/login')
    }
   const userId = req.session.user.id 
   if(!userId){
    console.log("the user id not found in the session ")
    return res.redirect('/user/login')
   }

   const user = await User.findById(userId)
   if(!user){
    console.log("user not found ")
    delete req.session.user;
    res.redirect('/user/login')
   }
    
 const result = await wishList.aggregate([
  { $match: { userId: new mongoose.Types.ObjectId(userId) } },
  { 
    $project: { 
      count: { $size: "$items" } } 
    } 
  
]);

const orderCount = await Order.countDocuments({userId})

   const wishCount = result[0].count
   const viewUser = {
    id:user._id.toString(),
    fullName:user.fullName,
    email:user.email,
    phone:user.phone,
    avatarUrl:user.avatar?.url||" ",
    dateOfBirth:user.dateOfBirth||user.createdAt,
    orderCount,
    wishCount,

   }
     const address= await Address.find({userId}).sort({createdAt:-1}).limit(1)
     console.log(address)
   res.render('user/profile',{
    
    user:viewUser,
    address
   })
}


exports.getProfileEdit =async (req,res)=>{
    const userID = req.session?.user.id;
    if(!userID){
        console.log("user id not found")
        return redirect('/');
    }


    const user = await User.findById(userID)
    
     
    res.render('user/profileEdit',{
        user,
        avatarUrl:user.avatar?.url||" "
    })

}
//update profile 
exports.validateUpdateProfile = [
  body("fullName")
    .trim()
    .notEmpty().withMessage("Full name is required")
    .isLength({ min: 3 }).withMessage("Full name must be at least 3 characters"),

  body("phone")
    .notEmpty().withMessage("Phone number is required")
    .isMobilePhone().withMessage("Invalid phone number"),

  body("dateOfbirth")
    .notEmpty().withMessage("Date of birth is required")
    .isISO8601().withMessage("Invalid date format (YYYY-MM-DD)"),
];
exports.updateProfile = async (req, res) => {
  const errors = validationResult(req).errors;
 
  if (errors.length>0) {
    
    return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Please fix the errors below', errors }
  }
    )}
  try {
    const { fullName, phone, dateOfBirth } = req.body;
     console.log("hello",errors)
    const userID = req.session?.user.id;
    if (!userID) {
      console.log("No user id");
      return res.redirect('/user/login');
    }

    const user = await User.findById(userID);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error:{
            code:"USER NOT FOUND",
            message: "User not found"
            
        }
        });
    }

    // const phoneExist = await User.findOne({
    //   phone,
    //   _id: { $ne: req.session.user._id }
    // });

    // if (phoneExist) {
    //   return res.status(400).json({
    //     success: false,
    //     error: { code: 'VALIDATION', message: 'Phone already exists' }
    //   });
    // }


    user.fullName = fullName;
    user.phone = phone;
    user.dateOfBirth = dateOfBirth;

    await user.save();

    return res.status(200).json({
     success:true,
      message: "Profile updated successfully",
      user
    });

  } catch (err) {
    console.error("Error in update profile:", err);
    return res.status(500).render('error/500', { err });
  }
};
// avathar
exports.uploadAvatar = async (req, res) => {
    console.log(req.file.buffer)
  try {
    console.log("imsiswee")
    if (!req.file) {
        console.log("erroreeeeee")
      return res.status(400).json({
    
        success: false,
        error: "No file uploaded"
      });
    }

   
    const uploadToCloudinary = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'superkicks/avatars',
            transformation: [
              { width: 500, height: 500, crop: 'fill' },
              { radius: 'max' }
            ],
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        stream.end(fileBuffer);
      });
    };

    const result = await uploadToCloudinary(req.file.buffer);

    try {
      const user = await User.findById(req.session.user.id);

      
      if (user.avatar && user.avatar.publicId) {
        await cloudinary.uploader.destroy(user.avatar.publicId);
      }
       console.log(result)
      user.avatar = {
        url: result.secure_url,
        publicId: result.public_id
      };

      await user.save();

      return res.json({
        success: true,
        data: {
          avatarUrl: user.avatar.url,
          message: "Avatar uploaded successfully"
        }
      });
    } catch (dberr) {
      console.error("Error while saving user avatar:", dberr);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile"
      });
    }
  } catch (error) {
    console.error("Avatar upload error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Server error during avatar upload"
    });
  }
};



exports.removeAvatar = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    
    if (user.avatarPublicId) {
      await cloudinary.uploader.destroy(user.avatarPublicId);
    }

    
    user.avatar = '/images/default-avatar.png';
    user.avatarPublicId = null;
    await user.save();

    res.json({
      success: true,
      data: {
        avatarUrl: user.avatar,
        message: 'Avatar removed successfully!'
      }
    });
    
  } catch (error) {
    console.error('Avatar removal error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error during avatar removal'
    });
  }
};


//passworddd
exports.validatePassword = [
    body('currentPassword').exists().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
      .matches(/\d/).withMessage('Password must contain at least one number'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
  ];
  exports.changePassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMap = errors.array().reduce((acc, err) => {
      acc[err.param] = err.msg;
      return acc;
    }, {});

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please fix the errors below',
        errors: errorMap  
      }
    });
  }

  try {
    const { currentPassword, newPassword } = req.body;


    const user = await User.findById(req.session.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }


    const passwordMatches = await bcrypt.compare(currentPassword, user.password);
    
    if (!passwordMatches) {
    
      return res.status(401).json({
        success: false,
        error: {
          errors: { currentPassword: 'Current password is incorrect' },
          message: 'Current password is incorrect'
        }
      });
    }

    
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    
    res.json({ 
      success: true,
      message: 'Password changed successfully' 
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Internal server error'
      }
    });
  }
}




//email change 






exports.validateEmail = [
  body('newEmail')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
    
  body('currentPassword')
    .notEmpty().withMessage('Current password is required')
];

exports.validateotp = [
  body('otp')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must contain only numbers')
];




exports.initiateEmailChange = async (req, res) => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: errors.array().reduce((acc, err) => {
          acc[err.param] = err.msg;
          return acc;
        }, {})
      }
    });
  }

  try {
    const { newEmail, currentPassword } = req.body;
    const userId = req.session.user.id;

    // Fetch user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }

    // Verify current password
    const passwordMatches = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: { 
          errors: { currentPassword: 'Current password is incorrect' },
          message: 'Current password is incorrect'
        }
      });
    }

    // Check if new email is different
    if (newEmail === user.email) {
      return res.status(400).json({
        success: false,
        error: { 
          errors: { newEmail: 'New email must be different from current email' },
          message: 'New email must be different'
        }
      });
    }

    // Check if email is already in use
    const emailExists = await User.findOne({ email: newEmail });
    if (emailExists) {
      return res.status(409).json({
        success: false,
        error: { 
          errors: { newEmail: 'Email is already in use' },
          message: 'Email already registered'
        }
      });
    }

    // Generate OTP (6 digits)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in session with expiration (10 minutes)
    req.session.emailChange = {
      newEmail,
      otp,
      expires: Date.now() + 600000 // 10 minutes
    };

    
    await transporter.sendMail({
      from: `"${process.env.APP_NAME}" <${process.env.EMAIL_USER}>`,
      to: newEmail,
      subject: 'Confirm Your Email Change',
      html: `
        <p>You requested to change your email address.</p>
        <p>Your verification code is: <strong>${otp}</strong></p>
        <p>This code will expire in 10 minutes.</p>
      `
    });

    res.json({
      success: true,
      message: 'Verification code sent to your new email'
    });

  } catch (error) {
    console.error('Email change initiation error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
};





exports.confirmEmailChange = async (req, res) => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: errors.array().reduce((acc, err) => {
          acc[err.param] = err.msg;
          return acc;
        }, {})
      }
    });
  }

  try {
    const { otp } = req.body;
    const userId = req.session.user.id;
    const sessionData = req.session.emailChange;
console.log(otp,sessionData)
    // Check if verification session exists
    if (!sessionData) {
      return res.status(400).json({
        success: false,
        error: { message: 'No pending email change request' }
      });
    }

    // Check expiration
    if (Date.now() > sessionData.expires) {
      delete req.session.emailChange;
      return res.status(410).json({
        success: false,
        error: { message: 'Verification code has expired' }
      });
    }

    // Verify OTP
    if (otp !== sessionData.otp) {
      return res.status(401).json({
        success: false,
        error: { 
          errors: { otp: 'Invalid verification code' },
          message: 'Invalid verification code'
        }
      });
    }

    // Update user email
    const user = await User.findById(userId);
    const oldEmail = user.email;
    user.email = sessionData.newEmail;
    await user.save();

    // Clear session data
    delete req.session.emailChange;

    // Send confirmation emails
    await Promise.all([
      // Notify new email
      transporter.sendMail({
        to: sessionData.newEmail,
        subject: 'Email Change Confirmed',
        text: `Your account email has been successfully updated to this address.`
      }),
      
      // Notify old email
      transporter.sendMail({
        to: oldEmail,
        subject: 'Email Changed',
        text: `Your account email has been changed to ${sessionData.newEmail}.`
      })
    ]);

    // Update session with new email
    req.session.user.email = sessionData.newEmail;

    res.json({
      success: true,
      message: 'Email updated successfully',
      newEmail: sessionData.newEmail
    });

  } catch (error) {
    console.error('Email confirmation error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
};











exports.resendEmailChangeOtp = async (req, res) => {
  try {
    const sessionData = req.session.emailChange;
    const userId = req.session.user.id;

   
    if (!sessionData) {
      return res.status(400).json({
        success: false,
        error: { message: 'No pending email change request' }
      });
    }

    if (Date.now() > sessionData.expires) {
      delete req.session.emailChange;
      return res.status(410).json({
        success: false,
        error: { message: 'Verification request has expired' }
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      delete req.session.emailChange;
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }

 
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();


    req.session.emailChange = {
      ...sessionData,
      otp: newOtp,
      expires: Date.now() + 600000 
    };


    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({
          success: false,
          error: { message: 'Failed to update session' }
        });
      }

      transporter.sendMail({
        from: `"${process.env.APP_NAME}" <${process.env.EMAIL_USER}>`,
        to: sessionData.newEmail,
        subject: 'New Verification Code',
        html: `
          <p>You requested a new verification code for your email change.</p>
          <p>Your new verification code is: <strong>${newOtp}</strong></p>
          <p>This code will expire in 10 minutes.</p>
        `
      })
      .then(() => {
        res.json({
          success: true,
          message: 'New verification code sent'
        });
      })
      .catch(emailError => {
        console.error('Email send error:', emailError);
        res.status(500).json({
          success: false,
          error: { message: 'Failed to send verification email' }
        });
      });
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
};