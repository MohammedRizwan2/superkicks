
function getImageUrl(img, placeholder = '/assets/placeholder.jpg') {
  if (!img) return placeholder;
  if (typeof img === 'string') return img;
  if (typeof img === 'object' && img.url) return img.url;
  return placeholder;
}

module.exports = { getImageUrl };
