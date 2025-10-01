const Product = require('../../models/product');
const Variant = require('../../models/variant.js');
const Category = require('../../models/category');
const User = require('../../models/userSchema');
const Wishlist = require('../../models/wish');
const Cart = require('../../models/cart');
const mongoose = require('mongoose')

// GET /api/cart - Get cart items
exports.getCart = async (req, res) => {
  try {
    
    const userId = req.session.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const cart = await Cart.findOne({ userId }).populate({
      path: 'items.variantId',
      populate: {
        path: 'productId',
        populate: {
          path: 'categoryId'
        }
      }
    });

    let cartItems = [];
    let subtotal = 0;

    if (cart && cart.items.length > 0) {
      cartItems = cart.items
        .filter(item => {
          return item.variantId && 
                 item.variantId.productId && 
                 item.variantId.productId.isListed &&
                 item.variantId.productId.categoryId &&
                 item.variantId.productId.categoryId.isListed;
        })
        .map(item => {
          const variant = item.variantId;
          const product = variant.productId;
          
          let image = '/images/placeholder.png';
          if (product.images && product.images.length > 0) {
            const firstImage = product.images[0];
            console.log(firstImage);
            if (typeof firstImage === 'string') {
              image = firstImage ;
            } else if (firstImage.url) {
              image = firstImage.url;
            }
          }

          const itemTotal = variant.salePrice * item.quantity;
          subtotal += itemTotal;

          return {
            variantId: variant._id.toString(),
            productId: product._id.toString(),
            productName: product.productName,
            description: product.description,
            brand: product.brand,
            size: variant.size,
            regularPrice: variant.regularPrice,
            salePrice: variant.salePrice,
            quantity: item.quantity,
            stock: variant.stock,
            image: image,
            itemTotal: itemTotal,
            hasDiscount: variant.salePrice < variant.regularPrice,
            discountPercent: variant.salePrice < variant.regularPrice 
              ? Math.round(((variant.regularPrice - variant.salePrice) / variant.regularPrice) * 100)
              : 0
          };
        });
    }

    const deliveryCharge = subtotal >= 2999 || subtotal === 0 ? 0 : 129;
    const taxRate = 0.18;
    const tax = subtotal * taxRate;
    const total = subtotal + deliveryCharge + tax;

    return res.json({
      success: true,
      data: {
        items: cartItems,
        totals: {
          subtotal,
          deliveryCharge,
          tax,
          total,
          itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0)
        }
      }
    });

  } catch (error) {
    console.error('Get cart error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

// Add cart
exports.addToCart = async (req, res) => {
  try {
    const { variantId, quantity = 1 } = req.body;
    
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!variantId || quantity < 1) {
      return res.status(400).json({
        success: false,
        error: 'Variant ID and valid quantity are required'
      });
    }

    const variant = await Variant.findById(variantId).populate({
      path: 'productId',
      populate: { path: 'categoryId' }
    });

    if (!variant || !variant.productId.isListed || !variant.productId.categoryId.isListed) {
      return res.status(400).json({
        success: false,
        error: 'Variant or product is not available or category is blocked'
      });
    }

    if (variant.stock < quantity) {
      return res.status(400).json({
        success: false,
        error: `Only ${variant.stock} items left in stock for this variant`
      });
    }

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    const itemIndex = cart.items.findIndex(item => item.variantId.toString() === variantId);
    
    if (itemIndex > -1) {
      const currentQuantity = cart.items[itemIndex].quantity;
      if (currentQuantity >= 5) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 5 items allowed per variant'
        });
      }

      const newQuantity = currentQuantity + quantity;
      if (newQuantity > variant.stock) {
        return res.status(400).json({
          success: false,
          error: `Cannot add more; only ${variant.stock} items left in stock`
        });
      }

      if (newQuantity > 5) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 5 items allowed per variant'
        });
      }

      cart.items[itemIndex].quantity = newQuantity;
    } else {
      if (quantity > 5) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 5 items allowed per variant'
        });
      }
      cart.items.push({
        productId: variant.productId._id,
        variantId,
        quantity,
        priceAtAdd: variant.salePrice
      });
    }

await Wishlist.updateOne(
  { userId },
  { $pull: { items: { variantId: new mongoose.Types.ObjectId(variantId) } } }
);


    await cart.save();

    return res.json({
      success: true,
      data: { message: 'Product added to cart successfully' }
    });

  } catch (err) {
    console.log('Add to cart error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Server error'
    });
  }
};

exports.updateCartQuantity = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { quantity, action } = req.body;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!variantId) {
      return res.status(400).json({
        success: false,
        error: 'Variant ID is required'
      });
    }


    if (!quantity && !action) {
      return res.status(400).json({
        success: false,
        error: 'Either quantity or action (increment/decrement) is required'
      });
    }

    if (action && !['increment', 'decrement'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Action must be either increment or decrement'
      });
    }

    if (quantity && (quantity < 0 || quantity > 5)) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be between 0 and 5'
      });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }

    const itemIndex = cart.items.findIndex(item => item.variantId.toString() === variantId);
    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Item not found in cart'
      });
    }

    const variant = await Variant.findById(variantId).populate({
      path: 'productId',
      populate: { path: 'categoryId' }
    });

    if (!variant || !variant.productId.isListed || variant.productId.categoryId.isBlocked) {
      cart.items.splice(itemIndex, 1);
      await cart.save();
      return res.status(400).json({
        success: false,
        error: 'Product is no longer available'
      });
    }

    let newQuantity;
    
    if (quantity !== undefined) {
      
      newQuantity = parseInt(quantity);
    } else {
      
      const currentQuantity = cart.items[itemIndex].quantity;
      if (action === 'increment') {
        newQuantity = currentQuantity + 1;
      } else {
        newQuantity = currentQuantity - 1;
      }
    }

    
    if (newQuantity <= 0) {
      cart.items.splice(itemIndex, 1);
      await cart.save();
      return res.json({
        success: true,
        data: { 
          message: 'Item removed from cart',
          removed: true 
        }
      });
    }


    if (newQuantity > variant.stock) {
      return res.status(400).json({
        success: false,
        error: `Only ${variant.stock} items available in stock`
      });
    }

    if (newQuantity > 5) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 5 items allowed per variant'
      });
    }

    cart.items[itemIndex].quantity = newQuantity;
    await cart.save();

    return res.json({
      success: true,
      data: { 
        message: 'Cart updated successfully',
        newQuantity 
      }
    });

  } catch (error) {
    console.error('Update cart quantity error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    const { variantId } = req.params;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!variantId) {
      return res.status(400).json({
        success: false,
        error: 'Variant ID is required'
      });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }

    const itemExists = cart.items.some(item => item.variantId.toString() === variantId);
    if (!itemExists) {
      return res.status(404).json({
        success: false,
        error: 'Item not found in cart'
      });
    }

    cart.items = cart.items.filter(item => item.variantId.toString() !== variantId);
    await cart.save();
   
    return res.json({
      success: true,
      data: { message: 'Item removed from cart successfully' }
    });

  } catch (error) {
    console.error('Remove from cart error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};


exports.clearCart = async (req, res) => {
  try {
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    await Cart.findOneAndUpdate(
      { userId },
      { items: [] },
      { upsert: true }
    );

    return res.json({
      success: true,
      data: { message: 'Cart cleared successfully' }
    });

  } catch (error) {
    console.error('Clear cart error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};


exports.renderCart = async (req, res) => {
  try {
    const userId = req.session.user?.id;
    
    if (!userId) {
      return res.redirect('/user/login');
    }

    
    res.render('user/cart', {
      cartItems: [], 
      totals: {
        subtotal: 0,
        deliveryCharge: 0,
        tax: 0,
        total: 0,
        itemCount: 0
      }
    });

  } catch (error) {
    console.error('Render cart error:', error);
    res.status(500).render('error', { message: 'Unable to load cart' });
  }
};



exports.getHeaderData = async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.json({
        isLoggedIn: false,
        cartCount: 0,
        wishCount: 0,
        avatar: '/img/default-avatar.jpg',
        userName: 'User'
      });
    }

    const user = await User.findById(userId);
    const cart = await Cart.findOne({ userId });
    const wish = await Wishlist.findOne({ userId });
  
    res.json({
      isLoggedIn: true,
      cartCount: cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0,
      wishCount: wish?.items?.length || 0,
      avatar: user?.avatar?.url || '/img/default-avatar.jpg',
      fullName: user?.fullName || user?.name || 'User'
    });
  } catch (err) {
    console.error('Header data API error:', err);
    res.status(500).json({ error: 'Failed to fetch header data' });
  }
};