const Category = require('../../models/category');
const Product = require('../../models/product');
const {getFeaturedProduct} = require('../../helper/featuredProduct');

exports.renderHomePage = async (req, res) => {
  try {
    const categories = await Category.find({ isListed: true })
      .sort({ createdAt: -1 })
      .limit(4);

    const products = await Product.aggregate([
      { $match: { isListed: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'categoryId',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
      { $match: { 'categoryInfo.isListed': true } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'variants',
          localField: 'variants',
          foreignField: '_id',
          as: 'variantDoc'
        }
      },
      {
        $addFields: {
          bestOffer: {
            $max: [
              { $ifNull: ['$offer', 0] },
              { $ifNull: ['$categoryInfo.offer', 0] }
            ]
          },
          lowestPrice: { $min: "$variantDoc.regularPrice" },
          lowestSalePrice: { $min: "$variantDoc.salePrice" }
        }
      }
    ]);

    const user = req.session && req.session.user ? req.session.user : null;
    const isLoggedIn = !!user;
    const justLoggedIn = !!req.session.justLoggedIn;
    delete req.session.justLoggedIn;
    const featuredProduct = await getFeaturedProduct()
    res.render('home', {
      categories,
      products,
      user,
      isLoggedIn,
      justLoggedIn,
      featuredProduct
    });
  } catch (error) {
    console.error('Error loading home page:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};
