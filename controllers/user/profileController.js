const mongoose = require('mongoose')
const User = require('../../models/userSchema');
const Address = require('../../models/address');
const { body, validationResult } = require('express-validator');

const cloudinary = require('../../config/cloudinary');



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


   const viewUser = {
    id:user._id.toString(),
    fullName:user.fullName,
    email:user.email,
    phone:user.phone,
    avatarUrl:user.image,
    createdAt:user.dateOfbirth||user.createdAt,

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
    
     console.log(user.avatar.url)
    res.render('user/profileEdit',{
        user,
        avatarUrl:user.avatar.url
    })

}

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



// exports.removeAvatar = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.id);
    
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         error: 'User not found'
//       });
//     }

//     // Remove from Cloudinary if exists
//     if (user.avatarPublicId) {
//       await cloudinary.uploader.destroy(user.avatarPublicId);
//     }

//     // Reset to default
//     user.avatar = '/images/default-avatar.png';
//     user.avatarPublicId = null;
//     await user.save();

//     res.json({
//       success: true,
//       data: {
//         avatarUrl: user.avatar,
//         message: 'Avatar removed successfully!'
//       }
//     });
    
//   } catch (error) {
//     console.error('Avatar removal error:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message || 'Server error during avatar removal'
//     });
//   }
// };