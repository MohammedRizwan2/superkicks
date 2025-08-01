const Product = require('../../models/product');
const Category = require('../../models/category');
const Review = require('../../models/reviews');
const mongoose = require('mongoose')

function buildPageUrl(basePath, queryParams, page) {
  const params = new URLSearchParams(queryParams);
  params.set('page', page);
  return `${basePath}?${params.toString()}`;
}


exports.getShop = async (req, res) => {
  try {

    const q = req.query.q ? req.query.q.trim() : '';
    const category = req.query.category || '';
    const priceMin = req.query.priceMin !== undefined && req.query.priceMin !== '' ? Number(req.query.priceMin) : undefined;
    const priceMax = req.query.priceMax !== undefined && req.query.priceMax !== '' ? Number(req.query.priceMax) : undefined;
    const sort = req.query.sort || '';
    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
    const limit = 8;
    const skip = (page - 1) * limit;


    const matchStage = { isListed: true };
    if (q) {
      matchStage.$or = [
        { productName: { $regex: q, $options: 'i' } },
        { brand: { $regex: q, $options: 'i' } }
      ];
    }
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      matchStage.categoryId = new mongoose.Types.ObjectId(category);
    }


    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'variants',
          localField: 'variants',
          foreignField: '_id',
          as: 'variantDocs'
        }
      },
      {
        $addFields: {
          lowestPrice: { $min: '$variantDocs.regularPrice' }
        }
      }
    ];


    if (priceMin !== undefined || priceMax !== undefined) {
      const priceFilter = {};
      if (priceMin !== undefined) priceFilter.$gte = priceMin;
      if (priceMax !== undefined) priceFilter.$lte = priceMax;
      if (Object.keys(priceFilter).length > 0) {
        pipeline.push({ $match: { lowestPrice: priceFilter } });
      }
    }


    let sortCondition = {};
    switch (sort) {
      case 'priceAsc':
        sortCondition = { lowestPrice: 1 };
        break;
      case 'priceDesc':
        sortCondition = { lowestPrice: -1 };
        break;
      case 'nameAsc':
        sortCondition = { productName: 1 };
        break;
      case 'nameDesc':
        sortCondition = { productName: -1 };
        break;
      case 'newest':
        sortCondition = { createdAt: -1 };
        break;
      default:
        sortCondition = { createdAt: -1 };
    }
    pipeline.push({ $sort: sortCondition });

    
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    
    pipeline.push({
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'categoryInfo'
      }
    });
    pipeline.push({ $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } });


    const products = await Product.aggregate(pipeline).exec();

    
    const countPipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'variants',
          localField: 'variants',
          foreignField: '_id',
          as: 'variantDocs'
        }
      },
      {
        $addFields: {
          lowestPrice: { $min: '$variantDocs.regularPrice' }
        }
      }
    ];

    if (priceMin !== undefined || priceMax !== undefined) {
      const priceFilter = {};
      if (priceMin !== undefined) priceFilter.$gte = priceMin;
      if (priceMax !== undefined) priceFilter.$lte = priceMax;
      if (Object.keys(priceFilter).length > 0) {
        countPipeline.push({ $match: { lowestPrice: priceFilter } });
      }
    }
    countPipeline.push({ $count: 'totalCount' });
    const countResult = await Product.aggregate(countPipeline).exec();
    const totalProducts = countResult.length > 0 ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalProducts / limit);


    const categories = await Category.find({ isListed: true }).sort({ name: 1 });


    const baseUrl = req.originalUrl.split('?')[0];
    
    console.log("query--->",req.query)
    const currentQuery = { ...req.query };
    
    function buildPageUrl(pageNum) {
      const params = new URLSearchParams(currentQuery);
      params.set('page', pageNum);
      return `${baseUrl}?${params.toString()}`;
    }

    const prevPageUrl = page > 1 ? buildPageUrl(page - 1) : null;
    const nextPageUrl = page < totalPages ? buildPageUrl(page + 1) : null;

    
    res.render('user/productlist', {
      products,
      categories,
      user: req.session.user || null,
      q,
      category,
      priceMin,
      priceMax,
      sort,
      currentPage: page,
      totalPages,
      prevPageUrl,
      nextPageUrl,
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};






exports.getProductDetails = async (req, res) => {
  try {
    const productId = req.params.id;

    
    const product = await Product.findById(productId)
      .populate('categoryId', 'name')           
      .populate('variants');                    

    
    if (!product || !product.isListed) {
      return res.redirect('/user/poduct/list');
    }

  
    
    const reviews = await Review.find({ productId })
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });

    
    

    
    const relatedProducts = await Product.find({
      categoryId: product.categoryId && product.categoryId._id,
      isListed: true,
      _id: { $ne: product._id }
    })
    .limit(4)
    .populate('variants');



    
    const errorMessage = req.query.error || null;

    res.render('user/productdetail', {
      product,
      reviews,
      relatedProducts,
      user: req.session.user || null,
      categories: [product.categoryId], 
      errorMessage
    });

  } catch (error) {
    console.error('Product details error:', error);
    res.redirect('/user/poduct/list');
  }
};
