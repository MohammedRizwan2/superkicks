const Wish = require('../../models/wish');
const Variant = require('../../models/variant');
const Product = require('../../models/product');

// GET /api/user/wishlist - Get user's wishlist
exports.getWishlist = async (req, res) => {
  try {
    const userId = req.session.user?.id;

    let wishlist = await Wish.findOne({ userId })
      .populate({
        path: 'items.variantId',
        populate: {
          path: 'productId',
          select: 'productName images brand categoryId offer isListed',
          match: { isListed: true }
        }
      });

    if (!wishlist) {
      return res.json({
        success: true,
        data: {
          items: [],
          totalItems: 0
        }
      });
    }

    // Filter out items where variant or product is null (inactive/deleted)
    const validItems = wishlist.items.filter(item => 
      item.variantId && 
      item.variantId.productId && 
      item.variantId.productId.isListed
    );

    // Process items for display
    const processedItems = validItems.map(item => {
      const variant = item.variantId;
      const product = variant.productId;
      
      return {
        variantId: variant._id,
        productId: product._id,
        productName: product.productName,
        brand: product.brand,
        images: product.images,
        size: variant.size,
        color: variant.color || null,
        price: variant.salePrice || variant.regularPrice,
        originalPrice: variant.regularPrice,
        stock: variant.stock,
        addedAt: item.createdAt || new Date()
      };
    });

    return res.json({
      success: true,
      data: {
        items: processedItems,
        totalItems: processedItems.length
      }
    });

  } catch (error) {
    console.error('Get wishlist error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch wishlist'
    });
  }
};

// POST /api/user/wishlist/:variantId - Add variant to wishlist
exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { variantId } = req.params;

    // Check if variant exists and product is listed
    const variant = await Variant.findById(variantId)
      .populate('productId', 'isListed');
    
    if (!variant || !variant.productId || !variant.productId.isListed) {
      return res.status(404).json({
        success: false,
        error: 'Product variant not found or unavailable'
      });
    }

    let wishlist = await Wish.findOne({ userId });

    if (!wishlist) {
      
      wishlist = new Wish({
        userId,
        items: [{ variantId }]
      });
    } else {
    
      const existingItem = wishlist.items.find(item => 
        item.variantId.toString() === variantId
      );
      
      if (existingItem) {
        return res.status(400).json({
          success: false,
          error: 'Product variant already in wishlist'
        });
      }

      // Add new item
      wishlist.items.push({ variantId });
    }

    await wishlist.save();

    return res.json({
      success: true,
      message: 'Product added to wishlist',
      data: {
        totalItems: wishlist.items.length
      }
    });

  } catch (error) {
    console.error('Add to wishlist error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add to wishlist'
    });
  }
};

// DELETE /api/user/wishlist/:variantId - Remove variant from wishlist
exports.removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { variantId } = req.params;

    const wishlist = await Wish.findOne({ userId });
    
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        error: 'Wishlist not found'
      });
    }

    // Remove item from wishlist
    wishlist.items = wishlist.items.filter(item => 
      item.variantId.toString() !== variantId
    );
    
    await wishlist.save();

    return res.json({
      success: true,
      message: 'Product removed from wishlist',
      data: {
        totalItems: wishlist.items.length
      }
    });

  } catch (error) {
    console.error('Remove from wishlist error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to remove from wishlist'
    });
  }
};

// DELETE /api/user/wishlist/clear - Clear entire wishlist
exports.clearWishlist = async (req, res) => {
  try {
    const userId = req.user.id;

    await Wish.findOneAndUpdate(
      { userId },
      { $set: { items: [] } },
      { upsert: true }
    );

    return res.json({
      success: true,
      message: 'Wishlist cleared successfully',
      data: {
        totalItems: 0
      }
    });

  } catch (error) {
    console.error('Clear wishlist error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to clear wishlist'
    });
  }
};

// GET /api/user/wishlist/check/:variantId - Check if variant is in wishlist
exports.checkWishlistStatus = async (req, res) => {
  try {
    console.log("hello");
    const userId = req.user.id;
    const { variantId } = req.params;

    const wishlist = await Wish.findOne({ 
      userId,
      'items.variantId': variantId 
    });

    return res.json({
      success: true,
      data: {
        inWishlist: !!wishlist
      }
    });

  } catch (error) {
    console.error('Check wishlist status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check wishlist status'
    });
  }
};



exports.renderWishlistPage = async (req, res) => {
  try {
    res.render('user/wishList', {
      title: 'My Wishlist | SuperKicks',
      user: req.user
    });
  } catch (error) {
    console.error('Render wishlist page error:', error);
    res.status(500).send('Server Error');
  }
};