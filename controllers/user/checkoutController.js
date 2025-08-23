const Cart = require('../../models/cart');
const Address = require('../../models/address');
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const Product = require('../../models/product');
const Variant = require('../../models/variant');


exports.renderCheckout = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    
    if (!userId) {
      return res.redirect('/user/login');
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

    
    if (!cart || cart.items.length === 0) {
      return res.redirect('/cart?error=empty-cart');
    }

  
    const addresses = await Address.find({ userId }).sort({ isDefault: -1, createdAt: -1 });

  
    let subtotal = 0;
    const cartItems = cart.items.map(item => {
      const variant = item.variantId;
      const product = variant.productId;
      const itemTotal = variant.salePrice * item.quantity;
      subtotal += itemTotal;

      return {
        variantId: variant._id.toString(),
        productId: product._id.toString(),
        productName: product.productName,
        brand: product.brand,
        size: variant.size,
        salePrice: variant.salePrice,
        regularPrice: variant.regularPrice,
        quantity: item.quantity,
        itemTotal: itemTotal,
       image: typeof product.images[0] === "string"? product.images[0] : product.images[0]?.url || '/images/placeholder.png'
      };
    });

    const deliveryCharge = subtotal >= 2999 ? 0 : 129;
    const taxRate = 0.18;
    const tax = subtotal * taxRate;
    const total = subtotal + tax + deliveryCharge;

    res.render('user/checkout', {
      user: req.session.user,
      addresses: addresses.map(addr => ({
        id: addr._id.toString(),
        name: addr.name,
        email: addr.email,
        phone: addr.phone,
        alternatePhone: addr.alternatePhone,
        country: addr.country,
        state: addr.state,
        address: addr.address,
        landmark: addr.landmark,
        pinCode: addr.pinCode,
        type: addr.type,
        isDefault: addr.isDefault
      })),
      cartItems,
      totals: {
        subtotal,
        deliveryCharge,
        tax,
        total,
        itemCount: cartItems.length
      }
    });

  } catch (error) {
    console.error('Render checkout error:', error);
    next(error);
  }
};


exports.placeOrder = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { addressId, paymentMethod = 'COD' } = req.body;

    if (!addressId) {
      return res.status(400).json({
        success: false,
        error: 'Shipping address is required'
      });
    }

  
    const cart = await Cart.findOne({ userId }).populate({
      path: 'items.variantId',
      populate: { path: 'productId' }
    });

    if (!cart || !cart.items?.length) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty'
      });
    }

  
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address selected'
      });
    }

    let subtotal = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const variant = item.variantId;
      const product = variant?.productId;

      if (!variant || !product) {
        return res.status(400).json({
          success: false,
          error: 'Invalid product or variant in cart'
        });
      }

      
      if (!product.isListed || variant.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `${product.productName} (size: ${variant.size}) is not available in the requested quantity`
        });
      }

  
      const itemTotal = variant.salePrice * item.quantity;
      subtotal += itemTotal;

    
      const orderItem = new OrderItem({
        productName: product.productName,
        productId: product._id,
        variantId: variant._id,
        price: variant.salePrice,
        quantity: item.quantity,
        status: 'Pending'
      });

      await orderItem.save();
      orderItems.push(orderItem._id);

    
      variant.stock -= item.quantity;
      await variant.save();
    }

  
    const deliveryCharge = subtotal >= 2999 ? 0 : 129;
    const tax = subtotal * 0.18;
    const total = subtotal + tax + deliveryCharge;

    const referenceNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

    
    const order = new Order({
      userId,
      referenceNo,
      paymentMethod,
      status: 'Pending',
      address: {
        name: address.name,
        email: address.email,
        phone: address.phone,
        alternatePhone: address.alternatePhone,
        country: address.country,
        state: address.state,
        address: address.address,
        landmark: address.landmark,
        pinCode: address.pinCode,
        type: address.type
      },
      total,
      orderItems
    });

   await order.save();


await OrderItem.updateMany(
  { _id: { $in: orderItems } },
  { $set: { orderId: order._id } }
);

await Cart.findOneAndUpdate(
  { userId },
  { $set: { items: [] } }, 
  { new: true }
);


return res.status(201).json({
  success: true,
  data: {
    orderId: order._id,
    referenceNo: order.referenceNo,
    message: 'Order placed successfully!'
  }
});

  } catch (error) {
    console.error(' Place order error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to place order. Please try again.'
    });
  }
};


exports.orderSuccess = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId } = req.params;

    if (!userId) {
      return res.redirect('/user/login');
    }

    const order = await Order.findOne({ _id: orderId, userId })
      .populate('orderItems');

    if (!order) {
      return res.redirect('/user/orders');
    }

    res.render('user/orderSuccess', {
      user: req.session.user,
      order: {
        id: order._id,
        referenceNo: order.referenceNo,
        total: order.total,
        status: order.status,
        orderDate: order.orderDate
      }
    });

  } catch (error) {
    console.error(' Order success error:', error);
    next(error);
  }
};
