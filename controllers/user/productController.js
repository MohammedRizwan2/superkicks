const Product = require('../../models/product');
const Category = require('../../models/category');
const Review = require('../../models/reviews');
const Variant = require('../../models/variant');
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

    // Build match stage
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

    // Main aggregation pipeline
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

    // Price filtering
    if (priceMin !== undefined || priceMax !== undefined) {
      const priceFilter = {};
      if (priceMin !== undefined) priceFilter.$gte = priceMin;
      if (priceMax !== undefined) priceFilter.$lte = priceMax;
      if (Object.keys(priceFilter).length > 0) {
        pipeline.push({ $match: { lowestPrice: priceFilter } });
      }
    }

    // Sorting
    let sortCondition = {};
    switch (sort) {
      case 'priceAsc': sortCondition = { lowestPrice: 1 }; break;
      case 'priceDesc': sortCondition = { lowestPrice: -1 }; break;
      case 'nameAsc': sortCondition = { productName: 1 }; break;
      case 'nameDesc': sortCondition = { productName: -1 }; break;
      case 'newest': sortCondition = { createdAt: -1 }; break;
      default: sortCondition = { createdAt: -1 };
    }
    pipeline.push({ $sort: sortCondition });

    // Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    // Category lookup
    pipeline.push({
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'categoryInfo'
      }
    });
    pipeline.push({ $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } });

    // Execute query
    const products = await Product.aggregate(pipeline).exec();

    // Count total products for pagination
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

    // Get categories for filter dropdown
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });

    // Build pagination URLs
    const baseUrl = req.originalUrl.split('?')[0];
    const currentQuery = { ...req.query };
    
    function buildPageUrl(pageNum) {
      const params = new URLSearchParams(currentQuery);
      params.set('page', pageNum);
      return `${baseUrl}?${params.toString()}`;
    }

    const prevPageUrl = page > 1 ? buildPageUrl(page - 1) : null;
    const nextPageUrl = page < totalPages ? buildPageUrl(page + 1) : null;

    // Prepare response
    const responseData = {
      products,
      categories,
      q,
      category,
      priceMin,
      priceMax,
      sort,
      currentPage: page,
      totalPages,
      prevPageUrl,
      nextPageUrl
    };

    // Return JSON for Axios or render EJS
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      res.json(responseData);
    } else {
      res.render('user/productlist', { 
        ...responseData,
        user: req.session.user || null 
      });
    }

  } catch (err) {
    console.error('Error fetching products:', err);
    if (req.xhr) {
      res.status(500).json({ error: 'Server error' });
    } else {
      res.status(500).render('error/500', { title: 'Server Error' });
    }
  }
};


exports.getProductDetails = async (req, res) => {
  try {
    const productId = req.params.id;

    // Get product with populated category and variants
    const product = await Product.findById(productId)
      .populate('categoryId', 'name')
      .populate('variants');

    if (!product || !product.isListed) {
      return res.redirect('/user/product/list');
    }

    // Get reviews with user info
    const reviews = await Review.find({ productId })
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });

    // Get related products (same category)
    const relatedProducts = await Product.find({
      categoryId: product.categoryId?._id,
      isListed: true,
      _id: { $ne: product._id }
    })
      .limit(4)
      .populate('variants');

    // Calculate initial pricing and stock
    const prices = product.variants 
      ? product.variants.map(v => v.salePrice > 0 ? v.salePrice : v.regularPrice)
      : [];
    const stock = product.variants 
      ? product.variants.reduce((tot, v) => tot + (v.stock || 0), 0)
      : 0;
    const hasOffer = product.offer > 0;
    const mrp = prices.length > 0 ? Math.min(...prices) : null;
    const discounted = hasOffer && mrp ? (mrp - (mrp * (product.offer / 100))) : mrp;

    res.render('user/productdetail', {
      product,
      reviews,
      relatedProducts,
      user: req.session.user || null,
      categories: [product.categoryId],
      errorMessage: req.query.error || null,
      // Pass calculated values to template
      stock,
      hasOffer,
      mrp,
      discounted
    });

  } catch (error) {
    console.error('Product details error:', error);
    res.redirect('/user/product/list');
  }
};

exports.getVariantDetails = async (req, res) => {
  try {
    const variantId = req.params.variantId;
    console.log("Fetching variant details for:", variantId);

    const variant = await Variant.findById(variantId)
      .populate({
        path: 'productId',
        select: 'offer coupon categoryId',
        populate: {
          path: 'categoryId',
          select: 'offer'
        }
      })
      .lean();

    if (!variant) {
      return res.status(404).json({ 
        success: false,
        error: 'Variant not found' 
      });
    }

    // Calculate best offer (product or category)
    const productOffer = variant.productId?.offer || 0;
    const categoryOffer = variant.productId?.categoryId?.offer || 0;
    const bestOffer = Math.max(productOffer, categoryOffer);

    ;

    res.json({
      success: true,
      price: variant.salePrice,
      regularPrice: variant.regularPrice,
      discountPercentage: bestOffer,
      stock: variant.stock,
      size: variant.size,
      coupon: variant.productId?.coupon || null,
      offerSource: bestOffer === productOffer ? 'product' : 'category'
    });

  } catch (error) {
    console.error('Error fetching variant:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};