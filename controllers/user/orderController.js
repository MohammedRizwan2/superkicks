const Order = require('../../models/order');
const Variant = require('../../models/variant');
const OrderItem= require('../../models/orderItem')
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Wallet = require('../../models/wallet'); 

// Helper function to process wallet refund
const processWalletRefund = async (userId, amount, orderId, type) => {
  try {
    let wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      wallet = new Wallet({
        userId,
        balance: 0,
        transactions: []
      });
    }

    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;
    const transactionId = `TXN${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

    const transaction = {
      transactionId,
      type: 'CREDIT',
      amount,
      description: type === 'ORDER_CANCELLATION' ? 
        `Refund for cancelled order` : 
        `Refund for cancelled item`,
      category: 'ORDER_REFUND',
      reference: {
        type: 'ORDER',
        referenceId: orderId.toString()
      },
      status: 'COMPLETED',
      balanceBefore,
      balanceAfter,
      createdAt: new Date()
    };

    wallet.balance = balanceAfter;
    wallet.transactions.push(transaction);
    
    await wallet.save();
    return wallet;
  } catch (error) {
    console.error('Wallet refund error:', error);
    throw error;
  }
};

// Helper function to calculate refund amount for individual item
const calculateItemRefund = async (order, cancelledItem) => {
  const totalItems = order.orderItems.length;
  const itemSubtotal = cancelledItem.price * cancelledItem.quantity;
  
  // Calculate proportional refund
  let refundAmount = itemSubtotal;
  
  // If there's a coupon, calculate proportional discount reduction
  if (order.coupon && order.coupon.discountAmount) {
    const orderSubtotal = order.orderItems.reduce((sum, item) => 
      sum + (item.price * item.quantity), 0
    );
    
    const itemProportion = itemSubtotal / orderSubtotal;
    const proportionalCouponDiscount = order.coupon.discountAmount * itemProportion;
    
    refundAmount -= proportionalCouponDiscount;
  }
  
  // Add proportional delivery charge if applicable
  if (order.deliveryCharge && totalItems === 1) {
    // If only one item, include full delivery charge
    refundAmount += order.deliveryCharge;
  } else if (order.deliveryCharge && totalItems > 1) {
    // Proportional delivery charge
    refundAmount += order.deliveryCharge / totalItems;
  }
  
  // Add proportional tax
  if (order.tax) {
    const taxProportion = itemSubtotal / (order.total - order.deliveryCharge - order.tax);
    refundAmount += order.tax * taxProportion;
  }
  
  return Math.round(refundAmount * 100) / 100; // Round to 2 decimal places
};

exports.orderList = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    
    if (!userId) {
      return res.redirect('/user/login');
    }

    res.render('user/orderList', {
      user: req.session.user
    });

  } catch (error) {
    console.error('Order list error:', error);
    next(error);
  }
};

// GET /api/orders 
exports.getOrders = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { search, status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = { userId };
    
    if (search) {
      query.referenceNo = { $regex: search, $options: 'i' };
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }

    const orders = await Order.find(query)
      .populate('orderItems')
      .sort({ orderDate: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);

    const processedOrders = orders.map(order => ({
      id: order._id,
      referenceNo: order.referenceNo,
      orderDate: order.orderDate,
      status: order.status,
      total: order.total,
      paymentMethod: order.paymentMethod,
      itemCount: order.orderItems.length,
      canCancel: ['Pending', 'Confirmed'].includes(order.status) && !order.isCancelled,
      canReturn: order.status === 'Delivered' && !order.isReturned,
      isCancelled: order.isCancelled,
      isReturned: order.isReturned,
      cancellationReason: order.cancellationReason,
      returnReason: order.returnReason,
      returnRequestDate: order.returnRequestDate,
    }));

    return res.json({
      success: true,
      data: {
        orders: processedOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalOrders,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
};

exports.cancelOrder = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId } = req.params;
    const { reason } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const order = await Order.findOne({ _id: orderId, userId })
      .populate('orderItems');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (!['Pending', 'Confirmed'].includes(order.status) || order.isCancelled) {
      return res.status(400).json({
        success: false,
        error: 'Order cannot be cancelled at this stage'
      });
    }

    // Calculate refund amount
    let refundAmount = 0;
    
    // Only refund if payment was made (not COD)
    if (order.paymentMethod !== 'COD') {
      refundAmount = order.total; // Full order total
    }

    // Update order status
    order.status = 'Cancelled';
    order.isCancelled = true;
    if (reason) {
      order.cancellationReason = reason;
    }

    // Update order items and restore stock
    for (const itemId of order.orderItems) {
      const orderItem = await OrderItem.findById(itemId);
      if (orderItem && !orderItem.isCancelled) {
        orderItem.status = 'Cancelled';
        orderItem.isCancelled = true;
        if (reason) {
          orderItem.cancellationReason = reason;
        }
        
        if (orderItem.statusHistory !== undefined) {
          orderItem.statusHistory = orderItem.statusHistory || [];
          orderItem.statusHistory.push({
            status: 'Cancelled',
            updatedBy: userId,
            updatedAt: new Date(),
            reason: reason || 'Cancelled by user'
          });
        }
        
        await orderItem.save();

        // Restore stock
        const variant = await Variant.findById(orderItem.variantId);
        if (variant) {
          variant.stock += orderItem.quantity;
          await variant.save();
        }
      }
    }

    await order.save();

    // Process wallet refund if applicable
    if (refundAmount > 0) {
      await processWalletRefund(userId, refundAmount, order._id, 'ORDER_CANCELLATION');
    }

    return res.json({
      success: true,
      message: refundAmount > 0 ? 
        `Order cancelled successfully. ₹${refundAmount} has been credited to your wallet.` :
        'Order cancelled successfully',
      data: {
        orderId: order._id,
        status: order.status,
        cancellationReason: order.cancellationReason,
        refundAmount
      }
    });

  } catch (error) {
    console.error('Cancel order error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel order'
    });
  }
};

// **NEW: Cancel Individual Order Item with Payment Failed Check**
exports.cancelOrderItem = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId, itemId } = req.params;
    const { reason } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const order = await Order.findOne({ _id: orderId, userId }).populate('orderItems');
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

  
    if (order.status === 'Payment Failed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot cancel items from orders with failed payments. Please retry payment or contact support.'
      });
    }

    const orderItem = await OrderItem.findById(itemId);
    if (!orderItem || !order.orderItems.some(item => item._id.toString() === itemId)) {
      return res.status(404).json({
        success: false,
        error: 'Order item not found'
      });
    }

    if (!['Pending', 'Confirmed'].includes(orderItem.status) || orderItem.isCancelled) {
      return res.status(400).json({
        success: false,
        error: 'Item cannot be cancelled at this stage'
      });
    }

    // Calculate refund amount for this item
    let refundAmount = 0;
    if (order.paymentMethod !== 'COD') {
      refundAmount = await calculateItemRefund(order, orderItem);
    }

    // Cancel the item
    orderItem.status = 'Cancelled';
    orderItem.isCancelled = true;
    if (reason) {
      orderItem.cancellationReason = reason;
    }
    
    if (orderItem.statusHistory !== undefined) {
      orderItem.statusHistory = orderItem.statusHistory || [];
      orderItem.statusHistory.push({
        status: 'Cancelled',
        updatedBy: userId,
        updatedAt: new Date(),
        reason: reason || 'Cancelled by user'
      });
    }
    
    await orderItem.save();

    // Restore stock
    const variant = await Variant.findById(orderItem.variantId);
    if (variant) {
      variant.stock += orderItem.quantity;
      await variant.save();
    }

    // Check if all items are cancelled
    const allItems = await OrderItem.find({ _id: { $in: order.orderItems } });
    const allCancelled = allItems.every(item => item.isCancelled);
    
    if (allCancelled) {
      order.status = 'Cancelled';
      order.isCancelled = true;
      await order.save();
    }

    // Process wallet refund if applicable
    if (refundAmount > 0) {
      await processWalletRefund(userId, refundAmount, order._id, 'ITEM_CANCELLATION');
    }

    return res.json({
      success: true,
      message: refundAmount > 0 ? 
        `Item cancelled successfully. ₹${refundAmount} has been credited to your wallet.` :
        'Item cancelled successfully',
      data: {
        itemId: orderItem._id,
        status: orderItem.status,
        cancellationReason: orderItem.cancellationReason,
        orderStatus: allCancelled ? 'Cancelled' : order.status,
        refundAmount
      }
    });

  } catch (error) {
    console.error('Cancel item error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel item'
    });
  }
};

exports.requestReturn = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId } = req.params;
    const { reason } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Return reason is required (minimum 10 characters)'
      });
    }

    const order = await Order.findOne({ _id: orderId, userId })
      .populate('orderItems');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (order.status !== 'Delivered') {
      return res.status(400).json({
        success: false,
        error: 'Only delivered orders can be returned'
      });
    }

    // Check if return request already exists
    if (order.status === 'Return Requested') {
      return res.status(400).json({
        success: false,
        error: 'Return request already submitted for this order'
      });
    }

    const deliveryDate = new Date(order.updatedAt);
    const returnWindow = 7 * 24 * 60 * 60 * 1000; 
    const now = new Date();
    
    if (now - deliveryDate > returnWindow) {
      return res.status(400).json({
        success: false,
        error: 'Return window has expired (7 days from delivery)'
      });
    }

    order.status = 'Return Requested';
    order.returnReason = reason.trim();
    order.returnRequestDate = new Date();

    for (const itemId of order.orderItems) {
      const orderItem = await OrderItem.findById(itemId);
      if (orderItem && orderItem.status === 'Delivered') {
        orderItem.status = 'Return Requested';
        orderItem.returnRequested = true;
        orderItem.returnReason = reason.trim();
        orderItem.returnRequestDate = new Date();
        
        // DO NOT set isReturned = true here
        
        if (orderItem.statusHistory !== undefined) {
          orderItem.statusHistory = orderItem.statusHistory || [];
          orderItem.statusHistory.push({
            status: 'Return Requested',
            updatedBy: userId,
            updatedAt: new Date(),
            reason: reason.trim()
          });
        }
        
        await orderItem.save();
      }
    }

    await order.save();

    return res.json({
      success: true,
      message: 'Return request submitted successfully. We will review and respond within 24-48 hours.',
      data: {
        orderId: order._id,
        status: order.status,
        returnReason: order.returnReason,
        returnRequestDate: order.returnRequestDate
      }
    });

  } catch (error) {
    console.error('Request return error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to submit return request'
    });
  }
};

//Search orders
exports.searchOrders = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { q } = req.query;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const orders = await Order.find({
      userId,
      referenceNo: { $regex: q.trim(), $options: 'i' }
    })
    .select('referenceNo orderDate status total')
    .sort({ orderDate: -1 })
    .limit(10);

    return res.json({
      success: true,
      data: orders.map(order => ({
        id: order._id,
        referenceNo: order.referenceNo,
        orderDate: order.orderDate,
        status: order.status,
        total: order.total
      }))
    });

  } catch (error) {
    console.error('Search orders error:', error);
    return res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
};

exports.orderDetails = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId } = req.params;
    console.log(orderId)
    
    if (!userId) {
      return res.redirect('/user/login');
    }

    const order = await Order.findOne({ _id: orderId, userId })
      .populate({
        path: 'orderItems',
        populate: {
          path: 'productId variantId',
        }
      });

    if (!order) {
      return res.redirect('/user/orders?error=order-not-found');
    }

    // Calculate offer discounts and prepare items data
    let totalOfferDiscount = 0;
    const processedItems = order.orderItems.map(item => {
      const regularPrice = item.variantId?.regularPrice || item.salePrice;
      const salePrice = item.variantId?.salePrice;
      const itemOfferDiscount = Math.max(0, (regularPrice - salePrice) * item.quantity);
      
      totalOfferDiscount += itemOfferDiscount;

      return {
        id: item._id,
        productName: item.productName,
        productId: item.productId?._id,
        variantId: item.variantId?._id,
        size: item.variantId?.size || 'N/A',
        price: item.price,
        regularPrice: regularPrice,
        quantity: item.quantity,
        status: item.status,
        itemTotal: item.price * item.quantity,
        offerDiscount: itemOfferDiscount,
        image: (typeof item.productId?.images?.[0] === "string" ? 
          item.productId.images[0] : 
          item.productId?.images?.[0]?.url) || '/images/placeholder.png',
        returnApproved: item.returnApproved,
        returnRejectionReason: item.returnRejectionReason || null,
        isCancelled: item.isCancelled,
        isReturned: item.isReturned,
        returnRequested: item.returnRequested,
        cancellationReason: item.cancellationReason,
        returnReason: item.returnReason,
        returnRequestDate: item.returnRequestDate
      }
    });

    // Extract coupon information
    const couponInfo = order.coupon ? {
      code: order.coupon.code,
      type: order.coupon.type,
      value: order.coupon.value,
      discountAmount: order.coupon.discountAmount || 0,
      description: order.coupon.type === 'PERCENT' ? 
        `${order.coupon.value}% off` : 
        `₹${order.coupon.value} flat discount`
    } : null;

    // Calculate totals
    const subtotal = order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryCharge = order.deliveryCharge || (subtotal >= 2999 ? 0 : 129);
    const tax = order.tax || Math.round(subtotal * 0.18);
    const couponDiscount = couponInfo ? couponInfo.discountAmount : 0;
    const total = order.total;
    const finalAmount = order.finalAmount || total;

    // Calculate savings
    const totalSavings = totalOfferDiscount + couponDiscount;
    const originalTotal = subtotal + totalOfferDiscount + deliveryCharge + tax;

    console.log(order.orderItems[0].returnApproved, "<<<<<<<<<");

    res.render('user/orderDetails', {
      user: req.session.user,
      order: {
        id: order._id,
        referenceNo: order.referenceNo,
        orderDate: order.orderDate,
        status: order.status,
        paymentMethod: order.paymentMethod,
        address: order.address,
        total: order.total,
        finalAmount: finalAmount,
        items: processedItems,
        coupon: couponInfo,
        cancellationReason: order.cancellationReason,
        returnReason: order.returnReason,
        returnRequestDate: order.returnRequestDate
      },
      totals: {
        subtotal,
        deliveryCharge,
        tax,
        total,
        finalAmount,
        originalTotal
      },
      discounts: {
        totalOfferDiscount,
        couponDiscount,
        totalSavings
      }
    });

  } catch (error) {
    console.error('Order details error:', error);
    next(error);
  }
};

///invoice
exports.downloadInvoice = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const { orderId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const order = await Order.findOne({ _id: orderId, userId })
      .populate('orderItems');

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const doc = new PDFDocument();
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.referenceNo}.pdf`);
    
    doc.pipe(res);

    // Add invoice content
    doc.fontSize(20).text('SUPERKICKS', { align: 'center' });
    doc.fontSize(16).text('INVOICE', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`Order Number: ${order.referenceNo}`);
    doc.text(`Order Date: ${new Date(order.orderDate).toLocaleDateString('en-IN')}`);
    doc.text(`Status: ${order.status}`);
    doc.moveDown();

    doc.text('Billing Address:');
    doc.text(`${order.address.name}`);
    doc.text(`${order.address.address}`);
    doc.text(`${order.address.state}, ${order.address.country} - ${order.address.pinCode}`);
    doc.text(`Phone: ${order.address.phone}`);
    doc.moveDown();

    doc.text('Items:');
    order.orderItems.forEach(item => {
      doc.text(`${item.productName} (Qty: ${item.quantity}) - ₹${item.price} = ₹${item.price * item.quantity}`);
    });
    
    doc.moveDown();
    doc.text(`Total: ₹${order.total}`, { align: 'right' });

    doc.end();

  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate invoice' });
  }
};

exports.returnOrderItem = async (req, res) => {
  try {
    console.log("here")
    const { orderId, itemId } = req.params;
    const { reason } = req.body;
    const userId = req.session.user?.id;

    console.log('Return item request:', { orderId, itemId, userId, reason });

    // Validate input
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Return reason is required and must be at least 10 characters long'
      });
    }

    const order = await Order.findOne({
      _id: orderId,
      userId: userId
    }).populate('orderItems');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    console.log('Order found with items:', { 
      orderId: order._id, 
      itemsCount: order.orderItems?.length 
    });

    const orderItem = order.orderItems.find(item => item._id.toString() === itemId.toString());

    if (!orderItem) {
      return res.status(404).json({
        success: false,
        error: 'Item not found in order'
      });
    }

    console.log('Order item found:', { 
      itemId: orderItem._id, 
      status: orderItem.status,
      isReturned: orderItem.isReturned,
      isCancelled: orderItem.isCancelled,
      returnRequested: orderItem.returnRequested
    });

    // Check if item can be returned
    if (orderItem.status !== 'Delivered') {
      return res.status(400).json({
        success: false,
        error: 'Item must be delivered before it can be returned'
      });
    }

    if (orderItem.isCancelled) {
      return res.status(400).json({
        success: false,
        error: 'Cancelled items cannot be returned'
      });
    }

    if (orderItem.returnRequested) {
      return res.status(400).json({
        success: false,
        error: 'Return request already submitted for this item'
      });
    }

    if (orderItem.isReturned || orderItem.status === 'Returned') {
      return res.status(400).json({
        success: false,
        error: 'Item has already been returned'
      });
    }

    const deliveryDate = new Date(order.updatedAt);
    const returnWindow = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    
    if (now - deliveryDate > returnWindow) {
      return res.status(400).json({
        success: false,
        error: 'Return window has expired (7 days from delivery)'
      });
    }

    await OrderItem.findByIdAndUpdate(itemId, {
      returnRequested: true,
      status: 'Return Requested', 
      returnReason: reason.trim(),
      returnRequestDate: new Date(),
      $push: {
        statusHistory: {
          status: 'Return Requested',
          updatedBy: userId,
          updatedAt: new Date(),
          reason: reason.trim()
        }
      }
    });

    console.log('Order item updated successfully - return requested');

    const updatedOrder = await Order.findById(orderId).populate('orderItems');
    
    const deliveredItems = updatedOrder.orderItems.filter(item => 
      item.status === 'Delivered' || item.status === 'Return Requested'
    );
    const allDeliveredItemsHaveReturnRequests = deliveredItems.every(item => 
      item.returnRequested || item.isCancelled
    );

    if (allDeliveredItemsHaveReturnRequests && deliveredItems.length > 0) {
      await Order.findByIdAndUpdate(orderId, {
        status: 'Return Requested',
        returnRequestDate: new Date()
      });
      console.log('Order status updated to Return Requested');
    }

    res.json({
      success: true,
      message: 'Item return request submitted successfully. We will process your request soon and notify you of the decision.'
    });

  } catch (error) {
    console.error('Return item error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process return request. Please try again.'
    });
  }
};
