const Cart = require('../../models/cart');
const Address = require('../../models/address');
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const Product = require('../../models/product');
const Variant = require('../../models/variant');
const Coupon = require('../../models/coupon');
const Razorpay = require('razorpay');
const crypto = require('crypto');


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const getAvailableCouponsForUser = async (userId, orderValue) => {
  try {
    const today = new Date();
    
    const allCoupons = await Coupon.find({
      isActive: true,
      isDeleted: false,
      startDate: { $lte: today },
      endDate: { $gte: today },
      minOrder: { $lte: orderValue }
    }).select('code description type value maxDiscount minOrder usageLimit perUserLimit usedCount');
    
    const availableCoupons = [];
    
    for (const coupon of allCoupons) {
      if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
        continue;
      }
      
      if (coupon.perUserLimit > 0) {
        const userUsageCount = await Order.countDocuments({
          userId: userId,
          'coupon.code': coupon.code
        });
        
        if (userUsageCount >= coupon.perUserLimit) {
          continue;
        }
      }
      
      availableCoupons.push(coupon);
    }
    
    return availableCoupons;
    
  } catch (error) {
    console.error('Error getting available coupons:', error);
    return [];
  }
};


const calculateDiscount = (coupon, orderValue) => {
  let discount = 0;
  
  if (coupon.type === 'PERCENT') {
    discount = Math.round((orderValue * coupon.value) / 100);
    if (coupon.maxDiscount > 0) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else if (coupon.type === 'FLAT') {
    discount = coupon.value;
  }
  
  return Math.min(discount, orderValue);
};

async function createOrderInDb(userId, addressId, paymentMethod, sessionCoupon = null, paymentDetails = {}) {
  const cart = await Cart.findOne({ userId }).populate({
    path: 'items.variantId',
    populate: { path: 'productId' }
  });

  if (!cart || !cart.items?.length) {
    throw new Error('Cart is empty');
  }

  const address = await Address.findOne({ _id: addressId, userId });
  if (!address) {
    throw new Error('Invalid address selected');
  }

  let subtotal = 0;
  const orderItems = [];

  for (const item of cart.items) {
    const variant = item.variantId;
    const product = variant?.productId;
    
    if (!variant || !product) {
      throw new Error('Invalid product or variant in cart');
    }
    
    if (!product.isListed || variant.stock < item.quantity) {
      throw new Error(`${product.productName} (size: ${variant.size}) is not available in the requested quantity`);
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
  const tax = Math.round(subtotal * 0.18);
  let discount = 0;
  let couponUsed = null;


  if (sessionCoupon && sessionCoupon.userId.toString() === userId.toString()) {
    const coupon = await Coupon.findById(sessionCoupon.couponId);
    if (coupon && subtotal >= coupon.minOrder) {
      discount = sessionCoupon.discountAmount || calculateDiscount(coupon, subtotal);
      couponUsed = {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discountAmount: discount
      };
    }
  }


  const total = Math.max(0, subtotal + tax + deliveryCharge - discount);
  const referenceNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);


  let orderStatus = 'Pending';
  if (paymentMethod === 'RAZORPAY' && paymentDetails.razorpayPaymentId) {
    orderStatus = 'Confirmed';
  } else if (paymentMethod === 'COD') {
    orderStatus = 'Pending';
  } else if (paymentMethod === 'WALLET') {
    orderStatus = 'Confirmed';
  }

  const orderData = {
    userId,
    referenceNo,
    paymentMethod,
    status: orderStatus,
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
    subtotal,
    deliveryCharge,
    tax,
    discount,
    total, 
    coupon: couponUsed,
    orderItems
  };


  if (paymentMethod === 'RAZORPAY' && paymentDetails) {
    orderData.razorpayPaymentId = paymentDetails.razorpayPaymentId;
    orderData.razorpayOrderId = paymentDetails.razorpayOrderId;
    orderData.razorpaySignature = paymentDetails.razorpaySignature;
  }

  const order = new Order(orderData);
  await order.save();
  if (couponUsed && sessionCoupon) {
    await Coupon.findByIdAndUpdate(sessionCoupon.couponId, {
      $inc: { usedCount: 1 }
    });
  }


  await OrderItem.updateMany(
    { _id: { $in: orderItems } },
    { $set: { orderId: order._id } }
  );


  await Cart.findOneAndUpdate(
    { userId },
    { $set: { items: [] } }
  );

  return order;
}
exports.placeOrder = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { addressId, paymentMethod = 'COD' } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!addressId) {
      return res.status(400).json({
        success: false,
        error: 'Shipping address is required'
      });
    }


    if (!['COD', 'WALLET'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment method for this endpoint'
      });
    }

    
    const order = await createOrderInDb(userId, addressId, paymentMethod, req.session.coupon);


    if (req.session.coupon) {
      delete req.session.coupon;
    }

    return res.status(201).json({
      success: true,
      data: {
        orderId: order._id,
        referenceNo: order.referenceNo,
        message: 'Order placed successfully!'
      }
    });

  } catch (error) {
    console.error('Place order error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to place order. Please try again.'
    });
  }
};


exports.createPaymentOrder = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { addressId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
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

    
    let subtotal = 0;
    cart.items.forEach(item => {
      subtotal += item.variantId.salePrice * item.quantity;
    });

    const deliveryCharge = subtotal >= 2999 ? 0 : 129;
  
    
    
    let discount = 0;
    if (req.session.coupon && req.session.coupon.userId.toString() === userId.toString()) {
    
      const coupon = await Coupon.findById(req.session.coupon.couponId);
      if (coupon && subtotal >= coupon.minOrder) {
        discount = calculateDiscount(coupon, subtotal);
      }
    }
      const taxableAmount =subtotal-discount;
    const tax = Math.round(taxableAmount * 0.18);
  
    const total = Math.max(0, subtotal + tax + deliveryCharge - discount);
    const referenceNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

    console.log('Creating Razorpay order with amount:', total);

    
    const razorpayOrder = await razorpay.orders.create({
      amount: total * 100, 
      currency: 'INR',
      receipt: referenceNo,
      notes: {
        userId: userId.toString(),
        addressId: addressId
      }
    });

    res.json({
      success: true,
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: total * 100,
        orderId: referenceNo,
        currency: 'INR',
        addressId: addressId,
        discount: discount
      }
    });

  } catch (error) {
    console.error('Create payment order error:', error);
    res.json({
      success: false,
      error: 'Failed to create payment order'
    });
  }
};
exports.verifyPayment = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { 
      razorpay_payment_id, 
      razorpay_order_id, 
      razorpay_signature, 
      addressId 
    } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

  
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.json({
        success: false,
        error: 'Payment verification failed'
      });
    }

    
    const paymentDetails = {
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      razorpaySignature: razorpay_signature
    };

    const order = await createOrderInDb(userId, addressId, 'RAZORPAY', req.session.coupon, paymentDetails);

  
    if (req.session.coupon) {
      delete req.session.coupon;
    }

    return res.json({
      success: true,
      data: {
        orderId: order._id,
        referenceNo: order.referenceNo,
        message: 'Payment verified and order placed successfully!'
      }
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    return res.json({
      success: false,
      error: error.message || 'Payment verification failed'
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
        orderDate: order.orderDate,
        coupon: order.coupon,
        discount: order.discount
      }
    });

  } catch (error) {
    console.error('Order success error:', error);
    next(error);
  }
};


exports.applyCoupon = async (req, res) => {
  try {
    const { couponCode, orderTotal } = req.body;
    const userId = req.session?.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      isActive: true,
      isDeleted: false,
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() },
      minOrder: { $lte: orderTotal }
    });

    if (!coupon) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired coupon code'
      });
    }

    if (coupon.usageLimit > 0) {
      const totalUses = await Order.countDocuments({
        'coupon.code': coupon.code
      });
      
      if (totalUses >= coupon.usageLimit) {
        return res.status(400).json({
          success: false,
          error: 'This coupon has reached its maximum usage limit.'
        });
      }
    }

    if (coupon.perUserLimit > 0) {
      const userUses = await Order.countDocuments({
        'coupon.code': coupon.code,
        userId: userId
      });
      
      if (userUses >= coupon.perUserLimit) {
        return res.status(400).json({
          success: false,
          error: 'You have already used this coupon the maximum number of times.'
        });
      }
    }

    const discount = calculateDiscount(coupon, orderTotal);
    
    req.session.coupon = {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discountAmount: discount,
      couponId: coupon._id,
      userId: userId
    };

    res.json({
      success: true,
      data: {
        couponCode: coupon.code,
        discountAmount: discount,
        description: coupon.description
      }
    });

  } catch (error) {
    console.error('Apply coupon error:', error);
    res.json({
      success: false,
      error: 'Failed to apply coupon'
    });
  }
};


exports.removeCoupon = async (req, res) => {
  try {
    delete req.session.coupon;
    
    res.json({
      success: true,
      message: 'Coupon removed successfully'
    });
    
  } catch (error) {
    console.error('Remove coupon error:', error);
    res.json({
      success: false,
      error: 'Failed to remove coupon'
    });
  }
};

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
        image: typeof product.images[0] === "string" ? product.images[0] : product.images[0]?.url || '/images/placeholder.png'
      };
    });

    const deliveryCharge = subtotal >= 2999 ? 0 : 129;
    const taxRate = 0.18;
    const tax = Math.round(subtotal * taxRate);
    
    let discount = 0;
    let couponCode = '';
    
    if (req.session.coupon && req.session.coupon.userId === userId) {
      const coupon = await Coupon.findOne({ 
        code: req.session.coupon.code, 
        isActive: true,
        isDeleted: false,
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() }
      });
      
      if (coupon && subtotal >= coupon.minOrder) {
        if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
          delete req.session.coupon;
        } else if (coupon.perUserLimit > 0) {
          const userUsageCount = await Order.countDocuments({
            userId: userId,
            'coupon.code': coupon.code
          });
          
          if (userUsageCount >= coupon.perUserLimit) {
            delete req.session.coupon;
          } else {
            couponCode = coupon.code;
            discount = calculateDiscount(coupon, subtotal);
          }
        } else {
          couponCode = coupon.code;
          discount = calculateDiscount(coupon, subtotal);
        }
      } else {
        delete req.session.coupon;
      }
    }
    
    const availableCoupons = await getAvailableCouponsForUser(userId, subtotal);
    const total = Math.max(0, subtotal + tax + deliveryCharge - discount);

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
        discount,
        total,
        itemCount: cartItems.length
      },
      couponCode,
      availableCoupons: availableCoupons.map(coupon => ({
        code: coupon.code,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount,
        minOrder: coupon.minOrder
      })),
      razorpayKeyId: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Render checkout error:', error);
    next(error);
  }
};
