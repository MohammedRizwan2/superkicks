// middlewares/upload.js
const multer = require('multer');

// ✅ Use memory storage so files are kept in RAM buffers
const uploadProductImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const isValid = allowedTypes.test(file.mimetype.toLowerCase());
    if (isValid) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
    }
  }
});





const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const isValid = allowedTypes.test(file.mimetype.toLowerCase());
    isValid ? cb(null, true) : cb(new Error('Only JPEG/PNG/WEBP images are allowed'));
  }
}).single('avatar');
module.exports = {
  uploadProductImages,
  avatarUpload
};
