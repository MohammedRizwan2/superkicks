const multer = require('multer');
const fs = require('fs')
const path = require('path');
// Consistent Multer configuration
const productImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/products');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'product-' + uniqueSuffix + ext);
  }
});

const uploadProductImages = multer({ 
  storage: productImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});


module.exports = {
  uploadProductImages
};
