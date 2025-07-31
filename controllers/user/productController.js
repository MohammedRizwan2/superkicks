const Product = require('../../models/product');
const Category = require('../../models/category');
const Review = require('../../models/reviews');

exports.getShop = async (req, res) => {
  try {
    // --- 1. Parse query params ---
    const q = req.query.q ? req.query.q.trim() : '';
    const category = req.query.category || '';
    const priceMin = req.query.priceMin !== undefined && req.query.priceMin !== '' ? Number(req.query.priceMin) : undefined;
    const priceMax = req.query.priceMax !== undefined && req.query.priceMax !== '' ? Number(req.query.priceMax) : undefined;
    const sort = req.query.sort || '';
    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
    const limit = 12; // Products per page

    // --- 2. Build Mongo filter ---
    const filter = {
      isListed: true, // Hide blocked/unlisted products
    };

    // Search (name/brand/case-insensitive)
    if (q) {
      filter.$or = [
        { productName: { $regex: q, $options: 'i' } },
        { brand: { $regex: q, $options: 'i' } }
      ];
    }

    // Category filter
    if (category) {
      filter.categoryId = category;
    }

    // We'll need price range filter based on lowest variant price:
    // To keep it efficient, filter products by variant price only after fetching, or precompute in aggregation if needed.
    // For moderate product counts, post-filtering is fine.

    // --- 3. Find all listed categories for filter dropdown ---
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });

    // --- 4. Build sort option ---
    let sortCondition = {};
    if (sort === 'priceAsc') {
      sortCondition = { 'variants.price': 1 };
    } else if (sort === 'priceDesc') {
      sortCondition = { 'variants.price': -1 };
    } else if (sort === 'nameAsc') {
      sortCondition = { productName: 1 };
    } else if (sort === 'nameDesc') {
      sortCondition = { productName: -1 };
    } else if (sort === 'newest') {
      sortCondition = { createdAt: -1 };
    } else {
      sortCondition = { createdAt: -1 }; // default: newest first
    }

    // --- 5. Fetch Products (with population) & filter variants ---
    let productQuery = Product.find(filter)
      .populate('categoryId', 'name')
      .populate('variants')
      .sort(sortCondition);

    // Pagination
    productQuery = productQuery.skip((page - 1) * limit).limit(limit);

    let products = await productQuery.exec();

    // --- 6. Further filter by price range (if set) on variant prices ---
    if (priceMin !== undefined || priceMax !== undefined) {
      products = products.filter(product => {
        if (!product.variants || product.variants.length === 0) return false;
        // Find lowest variant price per product
        const prices = product.variants.map(v => v.price).filter(p => typeof p === 'number');
        if (prices.length === 0) return false;
        const lowest = Math.min(...prices);
        if (priceMin !== undefined && lowest < priceMin) return false;
        if (priceMax !== undefined && lowest > priceMax) return false;
        return true;
      });
    }

    // --- 7. Count total matching documents for pagination ---
    // Best accuracy: repeat the filter steps without pagination
    const fullProductQuery = Product.find(filter).populate('variants');
    let allMatchingProducts = await fullProductQuery.exec();
    if (priceMin !== undefined || priceMax !== undefined) {
      allMatchingProducts = allMatchingProducts.filter(product => {
        if (!product.variants || product.variants.length === 0) return false;
        const prices = product.variants.map(v => v.price).filter(p => typeof p === 'number');
        if (prices.length === 0) return false;
        const lowest = Math.min(...prices);
        if (priceMin !== undefined && lowest < priceMin) return false;
        if (priceMax !== undefined && lowest > priceMax) return false;
        return true;
      });
    }
    const totalProducts = allMatchingProducts.length;
    const totalPages = Math.ceil(totalProducts / limit);

    // --- 8. Render the page ---
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
      totalPages
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};






exports.getProductDetails = async (req, res) => {
  try {
    const productId = req.params.id;

    // 1. Fetch product + related data
    const product = await Product.findById(productId)
      .populate('categoryId', 'name')           // For breadcrumbs
      .populate('variants');                    // For sizes/prices/stock

    // 2. Blocked/unlisted/unavailable: redirect to shop
    if (!product || !product.isListed) {
      return res.redirect('/user/poduct/list');
    }

    // 3. Fetch reviews (if model exists)
    // Assuming "Review" has { productId, user, text, rating }
    const reviews = await Review.find({ productId })
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });

    // 4. Highlights/specs (array of strings as product.highlights or derive/specify in model)
    // const highlights = product.highlights || [];

    // 5. Related products (same category, listed, not the same product)
    const relatedProducts = await Product.find({
      categoryId: product.categoryId && product.categoryId._id,
      isListed: true,
      _id: { $ne: product._id }
    })
    .limit(4)
    .populate('variants');

    // 6. Determine stock, price, etc.
    // All logic handled in EJS as well

    // 7. Optionally handle error message for out of stock or unavailable, for add-to-cart or reload
    // You can set some errorMessage if passed via req.flash, query, etc.
    const errorMessage = req.query.error || null;

    res.render('user/productdetail', {
      product,
      reviews,
      relatedProducts,
      user: req.session.user || null,
      categories: [product.categoryId], // for breadcrumb, extend if needed
      errorMessage
    });

  } catch (error) {
    console.error('Product details error:', error);
    res.redirect('/user/poduct/list');
  }
};
