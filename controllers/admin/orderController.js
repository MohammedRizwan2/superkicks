const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem')
const Variant = require('../../models/variant');
const Product = require('../../models/product');
const User = require('../../models/userSchema');
const Wallet = require('../../models/wallet');

exports.listOrder = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = 'all', sortBy = 'orderDate', order = 'desc' } = req.query;

    const skip = (page - 1) * limit;

    let query = {};

    if (search) {
      const user = await User.find({
        $or: [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      query = {
        $or: [
          { referenceNo: { $regex: search, $options: 'i' } },
          { userId: { $in: user.map(u => u._id) } }
        ]
      }
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const total = await Order.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    const orders = await Order.find(query)
      .populate('userId', 'fullName email phone')
      .populate('orderItems')
      .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const processedOrders = orders.map(order => ({
      id: order._id,
      referenceNo: order.referenceNo,
      orderDate: order.orderDate,
      status: order.status,
      total: order.total,
      paymentMethod: order.paymentMethod,
      itemCount: order.orderItems.length,
      user: {
        id: order.userId?._id,
        name: order.userId?.fullName || 'N/A',
        email: order.userId?.email || 'N/A',
        phone: order.userId?.phone || 'N/A'
      },
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    }));

    return res.json({
      success: true,
      data: {
        orders: processedOrders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalOrders: total,
          limit: parseInt(limit),
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        filters: {
          search,
          status,
          sortBy,
          order
        }
      }
    });

  } catch (error) {
    console.error('Admin list orders API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
};

exports.renderOrdersPage = async (req, res) => {
  try {
    res.render('admin/orderList');
  } catch (error) {
    console.error('Render orders page error:', error);
    res.status(500).send('Server Error');
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, reason } = req.body;

    const validStatuses = [
      'Pending', 'Confirmed', 'Processing', 'Shipped', 
      'Out for Delivery', 'Delivered', 'Cancelled'
    ];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Valid statuses are: ' + validStatuses.join(', ')
      });
    }

    const order = await Order.findById(orderId).populate('orderItems');
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const statusFlow = {
      'Pending': ['Confirmed', 'Cancelled'],
      'Confirmed': ['Processing', 'Cancelled'], 
      'Processing': ['Shipped', 'Cancelled'],
      'Shipped': ['Out for Delivery', 'Delivered', 'Cancelled'],
      'Out for Delivery': ['Delivered', 'Cancelled'],
      'Delivered': ['Cancelled'],
      'Cancelled': [] 
    };

    if (!statusFlow[order.status]?.includes(status)) {
      if (order.status === 'Delivered' && status === 'Cancelled') {
        const hasReturnRequest = await OrderItem.exists({
          orderId: order._id,
          returnRequested: true
        });
        
        if (!hasReturnRequest) {
          return res.status(400).json({
            success: false,
            error: 'Cannot change delivered order status without return request'
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          error: `Cannot change status from ${order.status} to ${status}`
        });
      }
    }

    const oldStatus = order.status;
    order.status = status;

    if (status === 'Cancelled') {
      await OrderItem.updateMany(
        { 
          orderId: order._id, 
          status: { $nin: ['Delivered', 'Cancelled', 'Returned'] }
        },
        { 
          status: 'Cancelled',
          cancellationReason: reason || 'Order cancelled by admin'
        }
      );

      const itemsToCancel = await OrderItem.find({
        orderId: order._id,
        status: { $nin: ['Delivered', 'Cancelled', 'Returned'] }
      }).populate('variantId');

      for (const item of itemsToCancel) {
        if (item.variantId) {
          await Variant.findByIdAndUpdate(
            item.variantId._id,
            { $inc: { stock: item.quantity } }
          );
        }
      }
    }

    if (status === 'Delivered') {
      await OrderItem.updateMany(
        { 
          orderId: order._id, 
          status: { $nin: ['Cancelled', 'Returned'] }
        },
        { status: 'Delivered' }
      );
    }

    await order.save();

    return res.json({
      success: true,
      message: `Order status updated from ${oldStatus} to ${status}`,
      data: {
        orderId: order._id,
        status: order.status,
        oldStatus
      }
    });

  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update order status'
    });
  }
};

exports.updateItemStatus = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { status, reason } = req.body;

    const validStatuses = [
      'Pending', 'Confirmed', 'Processing', 'Shipped', 
      'Out for Delivery', 'Delivered', 'Cancelled',
      'Return Processing', 'Return Approved', 'Returned'
    ];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Valid statuses are: ' + validStatuses.join(', ')
      });
    }

    const orderItem = await OrderItem.findById(itemId)
      .populate('orderId')
      .populate('variantId');
      
    if (!orderItem) {
      return res.status(404).json({
        success: false,
        error: 'Order item not found'
      });
    }

    if ((orderItem.status === 'Delivered' || orderItem.status === 'Cancelled') && 
        !orderItem.returnRequested && status !== orderItem.status) {
      return res.status(400).json({
        success: false,
        error: `Cannot change status of ${orderItem.status.toLowerCase()} item without return request`
      });
    }

    const oldStatus = orderItem.status;

    if ((status === 'Cancelled' && oldStatus !== 'Cancelled') || 
        (status === 'Returned' && oldStatus !== 'Returned')) {
      if (orderItem.variantId) {
        await Variant.findByIdAndUpdate(
          orderItem.variantId._id,
          { $inc: { stock: orderItem.quantity } }
        );
      }
    }

    orderItem.status = status;
    
    if (status === 'Cancelled') {
      orderItem.cancellationReason = reason || 'Cancelled by admin';
    }

    await orderItem.save();

    await updateOverallOrderStatus(orderItem.orderId._id);

    return res.json({
      success: true,
      message: `Item status updated from ${oldStatus} to ${status}`,
      data: {
        itemId: orderItem._id,
        status: orderItem.status,
        oldStatus
      }
    });

  } catch (error) {
    console.error('Update item status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update item status'
    });
  }
};


async function calculateItemRefundAmount(order, orderItem) {
  try {
    console.log('Calculating refund for item:', orderItem._id);

    const allOrderItems = await OrderItem.find({ orderId: order._id });
    const itemSubtotal = orderItem.price * orderItem.quantity;
    
    const orderSubtotal = allOrderItems.reduce((sum, item) => 
      sum + (item.price * item.quantity), 0
    );
    
    const itemProportion = itemSubtotal / orderSubtotal;
    let refundAmount = itemSubtotal;
    let couponDiscountDeduction = 0;
    let taxRefund = 0;
    let deliveryRefund = 0;

   
    let orderCouponDiscount = 0;
    if (order.coupon && order.coupon.discountAmount) {
      orderCouponDiscount = order.coupon.discountAmount;
    }
    
    if (orderCouponDiscount > 0) {
      couponDiscountDeduction = Math.round(orderCouponDiscount * itemProportion * 100) / 100;
      refundAmount -= couponDiscountDeduction;
    }
    
  
    if (order.tax && order.tax > 0) {
      const itemAfterDiscount = itemSubtotal - couponDiscountDeduction;
      const orderAfterDiscount = orderSubtotal - orderCouponDiscount;
      
      if (orderAfterDiscount > 0) {
        const taxProportion = itemAfterDiscount / orderAfterDiscount;
        taxRefund = Math.round(order.tax * taxProportion * 100) / 100;
        refundAmount += taxRefund;
      }
    }
    
    
    const calculatedDeliveryCharge = order.total - orderSubtotal - (order.tax || 0) + orderCouponDiscount;
    
    if (calculatedDeliveryCharge > 0) {
      const activeItems = allOrderItems.filter(item => 
        !['Cancelled', 'Returned'].includes(item.status) && 
        item._id.toString() !== orderItem._id.toString()
      );
      
      if (activeItems.length === 0) {
        deliveryRefund = calculatedDeliveryCharge;
      } else {
        const remainingOrderValue = activeItems.reduce((sum, item) => 
          sum + (item.price * item.quantity), 0
        );
        
        if (remainingOrderValue < 2999) {
          deliveryRefund = Math.round(calculatedDeliveryCharge * itemProportion * 100) / 100;
        }
      }
      
      if (deliveryRefund > 0) {
        refundAmount += deliveryRefund;
      }
    }
    
    const finalRefund = Math.max(0, Math.round(refundAmount * 100) / 100);
    
    console.log('Refund breakdown:', {
      itemPrice: itemSubtotal,
      couponDiscount: -couponDiscountDeduction,
      taxRefund: taxRefund,
      deliveryRefund: deliveryRefund,
      finalRefund: finalRefund
    });
    
    return finalRefund;

  } catch (error) {
    console.error('Calculate refund amount error:', error);
    const basicRefund = orderItem.price * orderItem.quantity;
    if (order.coupon && order.coupon.discountAmount) {
      const allItems = await OrderItem.find({ orderId: order._id });
      const totalValue = allItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const proportion = basicRefund / totalValue;
      const discountDeduction = order.coupon.discountAmount * proportion;
      return Math.max(0, basicRefund - discountDeduction);
    }
    return basicRefund;
  }
}

async function calculateOrderRefundAmount(order) {
  try {
    return Math.round(order.total * 100) / 100;
  } catch (error) {
    console.error('Calculate order refund error:', error);
    return order.total;
  }
}

async function updateOverallOrderStatus(orderId) {
  try {
    const order = await Order.findById(orderId);
    const orderItems = await OrderItem.find({ orderId });

    if (!orderItems.length) return;

    const itemStatuses = orderItems.map(item => item.status);
    let newOrderStatus = order.status;

    if (itemStatuses.every(status => status === 'Delivered')) {
      newOrderStatus = 'Delivered';
    }
    else if (itemStatuses.every(status => status === 'Cancelled')) {
      newOrderStatus = 'Cancelled';
    }
    else if (itemStatuses.every(status => 
      ['Shipped', 'Out for Delivery', 'Delivered'].includes(status))) {
      if (itemStatuses.some(status => status === 'Out for Delivery')) {
        newOrderStatus = 'Out for Delivery';
      } else if (itemStatuses.every(status => 
        ['Shipped', 'Delivered'].includes(status))) {
        newOrderStatus = 'Shipped';
      }
    }
    else if (itemStatuses.some(status => 
      ['Processing', 'Shipped', 'Out for Delivery'].includes(status))) {
      newOrderStatus = 'Processing';
    }
    else if (itemStatuses.some(status => status === 'Confirmed')) {
      newOrderStatus = 'Confirmed';
    }

    if (newOrderStatus !== order.status) {
      order.status = newOrderStatus;
      await order.save();
    }

  } catch (error) {
    console.error('Update overall order status error:', error);
  }
}

exports.approveReturnRequest = async (req, res) => {
  try {
    const { itemId } = req.params;
    const adminId = req.session.admin?.id || req.user?.id;

    const orderItem = await OrderItem.findById(itemId)
      .populate('orderId')
      .populate('variantId');
      
    if (!orderItem) {
      return res.status(404).json({
        success: false,
        error: 'Order item not found'
      });
    }

    if (!orderItem.returnRequested) {
      return res.status(400).json({
        success: false,
        error: 'No return request found for this item'
      });
    }

    if (orderItem.status === 'Returned') {
      return res.status(400).json({
        success: false,
        error: 'Return request already processed'
      });
    }

    const refundAmount = await calculateItemRefundAmount(orderItem.orderId, orderItem);

    orderItem.status = 'Returned';
    orderItem.isReturned = true;
    orderItem.returnApproved = true;
    orderItem.returnProcessedDate = new Date();

    await orderItem.save();

    if (orderItem.variantId) {
      await Variant.findByIdAndUpdate(
        orderItem.variantId._id,
        { $inc: { stock: orderItem.quantity } }
      );
    }

    let refundProcessed = false;
    if (orderItem.orderId.paymentMethod !== 'COD' && refundAmount > 0) {
      try {
        await processWalletRefund(
          orderItem.orderId.userId, 
          refundAmount, 
          orderItem.orderId._id, 
          'ITEM_RETURN',
          orderItem._id
        );
        refundProcessed = true;
      } catch (refundError) {
        console.error('Refund processing failed:', refundError);
      }
    }

    await updateOverallOrderStatus(orderItem.orderId._id);

    const message = orderItem.orderId.paymentMethod === 'COD' 
      ? 'Return request approved successfully.' 
      : refundProcessed 
        ? `Return request approved successfully. ₹${refundAmount} credited to wallet.`
        : `Return request approved successfully. Refund of ₹${refundAmount} will be processed separately.`;

    res.json({
      success: true,
      message,
      item: {
        id: orderItem._id,
        status: orderItem.status,
        returnApproved: orderItem.returnApproved,
        returnProcessedDate: orderItem.returnProcessedDate
      },
      refundAmount,
      refundProcessed
    });

  } catch (error) {
    console.error('Approve return error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve return request'
    });
  }
};

async function processWalletRefund(userId, amount, orderId, type, itemId = null) {
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
    const transactionId = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const transaction = {
      transactionId: transactionId,
      type: 'CREDIT',
      amount: amount,
      description: getRefundDescription(type, orderId, itemId),
      category: 'ORDER_REFUND',
      reference: {
        type: 'ORDER',
        referenceId: orderId.toString()
      },
      status: 'COMPLETED',
      balanceBefore: balanceBefore,
      balanceAfter: balanceAfter,
      createdAt: new Date()
    };

    wallet.balance = balanceAfter;
    wallet.transactions.push(transaction);
    
    await wallet.save();

    return {
      success: true,
      amount,
      newBalance: wallet.balance,
      transactionId
    };

  } catch (error) {
    console.error('Process wallet refund error:', error);
    throw error;
  }
}

function getRefundDescription(type, orderId, itemId) {
  const orderRef = orderId.toString().slice(-8).toUpperCase();
  
  switch (type) {
    case 'ITEM_RETURN':
      return `Refund for returned item in order #${orderRef}`;
    case 'ORDER_RETURN':
      return `Refund for returned order #${orderRef}`;
    case 'ORDER_CANCELLATION':
      return `Refund for cancelled order #${orderRef}`;
    case 'ITEM_CANCELLATION':
      return `Refund for cancelled item in order #${orderRef}`;
    default:
      return `Refund for order #${orderRef}`;
  }
}

exports.rejectReturnRequest = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid reason for rejection'
      });
    }

    const orderItem = await OrderItem.findById(itemId);
    if (!orderItem) {
      return res.status(404).json({
        success: false,
        error: 'Order item not found'
      });
    }

    if (!orderItem.returnRequested) {
      return res.status(400).json({
        success: false,
        error: 'No return request found for this item'
      });
    }

    if (orderItem.returnApproved === false) {
      return res.status(400).json({
        success: false,
        error: 'Return request already rejected'
      });
    }

    orderItem.returnRequested = false;
    orderItem.returnApproved = false;
    orderItem.returnRejectionReason = reason.trim();
    orderItem.returnProcessedDate = new Date();

    await orderItem.save();
    
    res.json({
      success: true,
      message: 'Return request rejected successfully',
      item: orderItem
    });

  } catch (error) {
    console.error('Reject return error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject return request'
    });
  }
};

exports.getAdminOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate({
        path: 'orderItems',
        populate: [
          { path: 'productId', model: 'Product' },
          { path: 'variantId', model: 'Variant' }
        ]
      });

    if (!order) {
      return res.status(404).render('error/404', {
        message: 'Order not found',
        title: 'Order Not Found'
      });
    }

    const processedItems = order.orderItems.map(item => ({
      id: item._id,
      _id: item._id,
      productName: item.productName,
      image: (typeof item.productId?.images?.[0] === "string" ? item.productId.images[0] : item.productId?.images?.[0]?.url) || '/images/placeholder.png',
      size: item.variantId?.size || 'N/A',
      color: item.variantId?.color || null,
      quantity: item.quantity,
      price: item.price,
      itemTotal: item.price * item.quantity,
      status: item.status,
      isCancelled: item.isCancelled || false,
      cancellationReason: item.cancellationReason || null,
      isReturned: item.isReturned || false,
      returnReason: item.returnReason || null,
      returnRequestDate: item.returnRequestDate || null,
      returnRequested: item.returnRequested || false,
      returnApproved: item.returnApproved, 
      returnRejectionReason: item.returnRejectionReason || null,
      returnProcessedDate: item.returnProcessedDate || null,
      statusHistory: item.statusHistory || []
    }));

    const totals = {
      subtotal: order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      deliveryCharge: Math.max(0, order.total - order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0) - (order.tax || 0) + (order.coupon?.discountAmount || 0)),
      tax: order.tax || 0,
      discount: order.coupon?.discountAmount || 0
    };

    const orderWithProcessedItems = {
      ...order.toObject(),
      items: processedItems,
      orderItems: processedItems
    };

    res.render('admin/orderDetails', { 
      order: orderWithProcessedItems, 
      totals,
      title: `Admin - Order #${order.referenceNo}` 
    });

  } catch (error) {
    console.error('Admin order details error:', error);
    res.status(500).render('error/500', {
      message: 'Failed to load order details',
      title: 'Error'
    });
  }
};

module.exports = exports;
