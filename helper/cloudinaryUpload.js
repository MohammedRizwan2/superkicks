
const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

function uploadBufferToCloudinary(buffer, folder = 'superkicks/products') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

module.exports = { uploadBufferToCloudinary };
