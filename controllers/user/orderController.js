const Order = require('../../models/order');
const Variant = require('../../models/variant');
const OrderItem = require('../../models/orderItem');
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


const calculateItemRefund = async (order, cancelledItem) => {
  const totalItems = order.orderItems.length;
  const itemSubtotal = cancelledItem.price * cancelledItem.quantity;
  
  let refundAmount = itemSubtotal;
  
  // Handle coupon proportionally
  if (order.coupon && order.coupon.discountAmount) {
    const orderSubtotal = order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const itemProportion = itemSubtotal / orderSubtotal;
    
    const proportionalCouponDiscount = order.coupon.discountAmount * itemProportion;
    
    refundAmount -= proportionalCouponDiscount;
  }
  
  // Handle delivery charge
  if (order.deliveryCharge) {
    if (totalItems === 1) {
      refundAmount += order.deliveryCharge;
    } else {
      refundAmount += order.deliveryCharge / totalItems;
    }
  }
  
  // Handle tax proportionally
  if (order.tax) {
    const orderSubtotal = order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const taxProportion = itemSubtotal / orderSubtotal;
    refundAmount += order.tax * taxProportion;
  }
  
  return Math.max(0, Math.round(refundAmount * 100) / 100);  // Ensure non-negative
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
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // 1. 📢 FIX: Destructure paymentMethod from req.query
    const { search, status, paymentMethod, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = { userId };
    
    if (search) {
      query.referenceNo = { $regex: search, $options: 'i' };
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }

    // 2. 📢 FIX: Apply Payment Method Filter
    if (paymentMethod && paymentMethod !== 'all') {
      query.paymentMethod = paymentMethod;
    }

    // 3. Execute query with dynamic filters
    const orders = await Order.find(query)
      .populate('orderItems')
      .sort({ orderDate: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);

    // 4. Process Orders and Calculate Flags
    const processedOrders = orders.map(order => {
        // Check item statuses to determine if full cancellation is possible (data integrity)
        const isAnyItemFulfilled = order.orderItems.some(item => 
            ['Shipped', 'Out for Delivery', 'Delivered', 'Returned', 'Return Requested'].includes(item.status)
        );
        
        const canCancelOrder = (
            ['Pending', 'Confirmed'].includes(order.status) && 
            !order.isCancelled && 
            !isAnyItemFulfilled
        );

        // Calculate pagination display indices
        const startIndex = totalOrders > 0 ? skip + 1 : 0;
        const endIndex = Math.min(skip + parseInt(limit), totalOrders);
        
        return ({
            id: order._id,
            referenceNo: order.referenceNo,
            orderDate: order.orderDate,
            status: order.status,
            total: order.total,
            paymentMethod: order.paymentMethod,
            itemCount: order.orderItems.length,
            
            // 📢 Calculated Flags
            canCancel: canCancelOrder, 
            canReturn: order.status === 'Delivered' && !order.isReturned,
            canRetryPayment: order.status === 'Payment Failed',
            
            isCancelled: order.isCancelled,
            isReturned: order.isReturned,
            cancellationReason: order.cancellationReason,
            returnReason: order.returnReason,
            returnRequestDate: order.returnRequestDate,
            discount: order.coupon?.discountAmount || 0, // Ensure discount is available for display
        });
    });

    return res.json({
      success: true,
      data: {
        orders: processedOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalOrders,
          hasNext: page < totalPages,
          hasPrev: page > 1,
          startIndex: totalOrders > 0 ? skip + 1 : 0,
          endIndex: Math.min(skip + parseInt(limit), totalOrders)
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

    // Calculate refund amount only for non-cancelled items
    let refundAmount = 0;
    
    // Only refund if payment was made (not COD)
    if (order.paymentMethod !== 'COD') {
      // Sum refunds for each non-cancelled item
      for (const item of order.orderItems) {
        if (!item.isCancelled) {
          refundAmount += await calculateItemRefund(order, item);
        }
      }
    }

    // Update order status
    order.status = 'Cancelled';
    order.isCancelled = true;
    if (reason) {
      order.cancellationReason = reason;
    }

    // Update order items and restore stock
    for (const item of order.orderItems) {
      if (!item.isCancelled) {
        item.status = 'Cancelled';
        item.isCancelled = true;
        if (reason) {
          item.cancellationReason = reason;
        }
        
        if (item.statusHistory !== undefined) {
          item.statusHistory = item.statusHistory || [];
          item.statusHistory.push({
            status: 'Cancelled',
            updatedBy: userId,
            updatedAt: new Date(),
            reason: reason || 'Cancelled by user'
          });
        }
        
        await item.save();

        // Restore stock
        const variant = await Variant.findById(item.variantId);
        if (variant) {
          variant.stock += item.quantity;
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

    // Calculate refund amount
    let refundAmount = 0;
    if (order.paymentMethod !== 'COD') {
      refundAmount = await calculateItemRefund(order, orderItem);
    }

    // Update order item
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
    const {orderId: referenceNo} = req.params;
  
    
    if (!userId) {
      return res.redirect('/user/login');
    }

    const order = await Order.findOne({ referenceNo: referenceNo, userId })
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