const mongoose = require('mongoose');
const Cart = require('../../models/cart');
const Address = require('../../models/address');
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const Product = require('../../models/product');
const Variant = require('../../models/variant');
const Coupon = require('../../models/coupon');
const Wallet = require('../../models/wallet');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Helper function to get available coupons
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

// Helper function to calculate discount
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

// Helper function to calculate order totals
const calculateOrderTotals = (cartItems, sessionCoupon = null) => {
  let subtotal = 0;
  
  cartItems.forEach(item => {
    subtotal += item.variantId.salePrice * item.quantity;
  });

  const deliveryCharge = subtotal >= 2999 ? 0 : 129;
  const tax = Math.round(subtotal * 0.18);
  let discount = 0;
  let couponUsed = null;

  if (sessionCoupon) {
    discount = sessionCoupon.discountAmount || 0;
    couponUsed = {
      code: sessionCoupon.code,
      type: sessionCoupon.type,
      value: sessionCoupon.value,
      discountAmount: discount
    };
  }

  const total = Math.max(0, subtotal + tax + deliveryCharge - discount);

  return {
    subtotal,
    deliveryCharge,
    tax,
    discount,
    total,
    couponUsed
  };
};
// Centralized order creation function - FIXED
async function createOrderInDb(userId, addressId, paymentMethod, sessionCoupon = null, paymentDetails = {}) {
  console.log("inside the create orderedb ")
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cart = await Cart.findOne({ userId }).populate({
      path: 'items.variantId',
      populate: { path: 'productId' }
    }).session(session);

    if (!cart || !cart.items?.length) {
      throw new Error('Cart is empty');
    }

    const address = await Address.findOne({ _id: addressId, userId }).session(session);
    if (!address) {
      throw new Error('Invalid address selected');
    }

    const wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Validate stock and create order items
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

      const orderItem = new OrderItem({
        productName: product.productName,
        productId: product._id,
        variantId: variant._id,
        price: variant.salePrice,
        quantity: item.quantity,
        status: paymentMethod === 'PAYMENT_FAILED' ? 'Payment Failed' : 'Pending'
      });

      await orderItem.save({ session });
      orderItems.push(orderItem._id);

      // Only deduct stock for successful payments (not failed payments)
      if (paymentMethod !== 'PAYMENT_FAILED') {
        variant.stock -= item.quantity;
        await variant.save({ session });
      }
    }

    // Calculate totals
    const totals = calculateOrderTotals(cart.items, sessionCoupon);

    // Validate wallet balance for wallet payments
    if (paymentMethod === 'WALLET' && wallet.balance < totals.total) {
      throw new Error('Insufficient wallet balance');
    }

    const referenceNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

    // Determine order status
    let orderStatus = 'Pending';
    if (paymentMethod === 'PAYMENT_FAILED') {
      orderStatus = 'Payment Failed';
    }

    const orderData = {
      userId,
      referenceNo,
      paymentMethod: paymentMethod === 'PAYMENT_FAILED' ? 'RAZORPAY' : paymentMethod,
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
      subtotal: totals.subtotal,
      deliveryCharge: totals.deliveryCharge,
      tax: totals.tax,
      discount: totals.discount,
      total: totals.total,
      coupon: totals.couponUsed,
      orderItems,
      transactionId: `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`
    };

    // Add payment details
    if (paymentMethod === 'RAZORPAY' && paymentDetails) {
      orderData.razorpayPaymentId = paymentDetails.razorpayPaymentId;
      orderData.razorpayOrderId = paymentDetails.razorpayOrderId;
      orderData.razorpaySignature = paymentDetails.razorpaySignature;
    } else if (paymentMethod === 'PAYMENT_FAILED' && paymentDetails.razorpayOrderId) {
      orderData.razorpayOrderId = paymentDetails.razorpayOrderId;
    }

    const order = new Order(orderData);
    await order.save({ session });

    // Handle wallet payment
    if (paymentMethod === 'WALLET') {
      const balanceBefore = wallet.balance;
      wallet.balance -= totals.total;
      wallet.transactions.push({
        transactionId: orderData.transactionId,
        type: 'DEBIT',
        amount: totals.total,
        description: `Payment for order #${referenceNo}`,
        category: 'ORDER_PAYMENT',
        reference: { type: 'ORDER', referenceId: order._id.toString() },
        status: 'COMPLETED',
        balanceBefore,
        balanceAfter: wallet.balance,
        createdAt: new Date()
      });
      await wallet.save({ session });
    }


    if (totals.couponUsed && sessionCoupon && paymentMethod !== 'PAYMENT_FAILED') {
      await Coupon.findByIdAndUpdate(sessionCoupon.couponId, {
        $inc: { usedCount: 1 }
      }).session(session);
    }

    // Update order items with order ID
    await OrderItem.updateMany(
      { _id: { $in: orderItems } },
      { $set: { orderId: order._id } }
    ).session(session);

  
    await Cart.findOneAndUpdate(
      { userId },
      { $set: { items: [] } }
    ).session(session);

    await session.commitTransaction();
    return order;

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
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

    // Clear session coupon
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

// Create Razorpay payment order
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

    // Calculate totals
    const totals = calculateOrderTotals(cart.items, req.session.coupon);
    const referenceNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

    const razorpayOrder = await razorpay.orders.create({
      amount: totals.total * 100,
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
        amount: totals.total * 100,
        orderId: referenceNo,
        currency: 'INR',
        addressId: addressId,
        discount: totals.discount
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

// Create failed order (called from frontend) - FIXED
exports.createPaymentFailedOrder = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { addressId, razorpayOrderId, errorMessage } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!addressId) {
      return res.status(400).json({
        success: false,
        error: 'Address ID is required'
      });
    }

    const paymentDetails = {
      razorpayOrderId: razorpayOrderId || null
    };

    const order = await createOrderInDb(userId, addressId, 'PAYMENT_FAILED', req.session.coupon, paymentDetails);

    return res.status(201).json({
      success: true,
      data: {
        orderId: order._id,
        referenceNo: order.referenceNo,
        message: 'Order created with payment failed status'
      }
    });

  } catch (error) {
    console.error('Create payment failed order error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create payment failed order'
    });
  }
};

// Payment failure page - FIXED
exports.paymentFailure = async (req, res, next) => {
  try {
    let orderData;
    
   
      const payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
      orderData = {
        orderId: payload.orderId || '',
        referenceNo: payload.referenceNo || '',
        amount: payload.amount ? parseFloat(payload.amount) : 0,
        paymentMethod: payload.paymentMethod || 'RAZORPAY',
        errorMessage: payload.errorMessage || 'Payment processing failed. Please try again.',
        razorpayOrderId: payload.razorpayOrderId || '',
        addressId: payload.addressId || ''
      };
    
    res.render('user/paymentFailure', {
      user: req.session.user,
      orderData: orderData
    });

  } catch (error) {
    console.error('Payment failure page error:', error);
    next(error);
  }
};

// Verify payment - returns JSON instead of redirects
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
        error: 'User not authenticated',
        redirect: `/user/payment-failure?razorpayOrderId=${razorpay_order_id}&paymentMethod=RAZORPAY&errorMessage=${encodeURIComponent('User not authenticated')}&addressId=${addressId || ''}`
      });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed',
        redirect: `/user/payment-failure?razorpayOrderId=${razorpay_order_id}&paymentMethod=RAZORPAY&errorMessage=${encodeURIComponent('Payment verification failed')}&addressId=${addressId}`
      });
    }

    // Create successful order
    const paymentDetails = {
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      razorpaySignature: razorpay_signature
    };

    const order = await createOrderInDb(userId, addressId, 'RAZORPAY', req.session.coupon, paymentDetails);

    // Clear session coupon
    if (req.session.coupon) {
      delete req.session.coupon;
    }

    return res.json({
      success: true,
      data: {
        orderId: order._id,
        referenceNo: order.referenceNo,
        redirect: `/user/order-success/${order._id}`
      }
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Payment verification failed',
      redirect: `/user/payment-failure?paymentMethod=RAZORPAY&errorMessage=${encodeURIComponent('Payment verification failed')}&addressId=${req.body.addressId || ''}`
    });
  }
};

// Retry payment
exports.retryPayment = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const order = await Order.findOne({ _id: orderId, userId, status: 'Payment Failed' });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Failed order not found'
      });
    }

    const referenceNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
    
    const razorpayOrder = await razorpay.orders.create({
      amount: order.total * 100,
      currency: 'INR',
      receipt: referenceNo,
      notes: {
        userId: userId.toString(),
        originalOrderId: order._id.toString()
      }
    });
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    res.json({
      success: true,
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: order.total * 100,
        orderId: order._id,
        currency: 'INR',
        total: order.total,
        razorpayKeyId: razorpayKeyId
      }
    });

  } catch (error) {
    console.error('Retry payment error:', error);
    res.json({
      success: false,
      error: 'Failed to initiate payment retry'
    });
  }
};

// Verify retry payment
exports.verifyRetryPayment = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { 
      razorpay_payment_id, 
      razorpay_order_id, 
      razorpay_signature, 
      orderId 
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

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updatedOrder = await Order.findByIdAndUpdate(orderId, {
        status: 'Pending',
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        razorpaySignature: razorpay_signature,
        updatedAt: new Date()
      }, { new: true, session });

      if (!updatedOrder) {
        throw new Error('Order not found');
      }

      // Deduct stock for retry payment
      const orderItems = await OrderItem.find({ orderId: updatedOrder._id }).session(session);
      for (const item of orderItems) {
        await Variant.findByIdAndUpdate(item.variantId, {
          $inc: { stock: -item.quantity }
        }).session(session);
      }

      // Clear cart
      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [] } }
      ).session(session);

      await session.commitTransaction();
   console.log(updatedOrder._id)
      return res.json({
        success: true,
        data: {
          orderId: updatedOrder._id,
          referenceNo: updatedOrder.referenceNo,
          message: 'Payment retry successful!'
        }
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Retry payment verification error:', error);
    return res.json({
      success: false,
      error: 'Payment retry verification failed'
    });
  }
};

// Order success page
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

// Apply coupon
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

// Remove coupon
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

// Render checkout page
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
      return res.redirect('/user/cart?error=empty-cart');
    }

    const wallet = await Wallet.findOne({ userId }).select('balance');
    if (!wallet) {
      return res.redirect('/user/cart?error=wallet-not-found');
    }

    const addresses = await Address.find({ userId }).sort({ isDefault: -1, createdAt: -1 });

    // Calculate totals
    const totals = calculateOrderTotals(cart.items, req.session.coupon);
    
    const cartItems = cart.items.map(item => {
      const variant = item.variantId;
      const product = variant.productId;
      const itemTotal = variant.salePrice * item.quantity;

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

    let couponCode = '';
    if (req.session.coupon && req.session.coupon.userId === userId) {
      couponCode = req.session.coupon.code;
    }
    
    const availableCoupons = await getAvailableCouponsForUser(userId, totals.subtotal);

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
        subtotal: totals.subtotal,
        deliveryCharge: totals.deliveryCharge,
        tax: totals.tax,
        discount: totals.discount,
        total: totals.total,
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
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      walletBalance: wallet.balance
    });

  } catch (error) {
    console.error('Render checkout error:', error);
    next(error);
  }
};
