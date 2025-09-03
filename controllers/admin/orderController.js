const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem')
const Variant = require('../../models/variant');
const Product = require('../../models/product');
const User = require('../../models/userSchema');
const Wallet = require('../../models/wallet');


exports.listOrder = async (req , res)=>{
    try{
      const {page = 1,limit=10,search='',status='all',sortBy='orderDate',order='desc'}=req.query;

      const skip= (page-1)* limit;

      let query ={};

      if(search){
        const user = await User.find({
            $or:[
                {fullName:{$regex:search,$options:'i' }},
                {email:{$regex:search,$options:'i'}},
                {phone:{$regex:search,$options:'i'}}
            ]
        }).select('_id');

        query = {
            $or:[
                {referenceNo:{$regex:search,$options:'i'}},
                {userId:{$in:user.map(u =>u._id)}}
            ]
        }
      }

      if(status && status !=='all'){
        query.status = status;
      }


      const total = await Order.countDocuments(query);
      const totalPages = Math.ceil(total/limit);


      const orders = await Order.find(query)
      .populate('userId','fullName email phone')
      .populate('orderItems')
      .sort({[sortBy]:order ==='desc'? -1:1})
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




module.exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, reason } = req.body;

    // Valid order statuses
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
    
  
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: status,
      updatedBy: req.user.id,
      updatedAt: new Date(),
      reason: reason || null
    });

  
    if (status === 'Cancelled') {
  
      await OrderItem.updateMany(
        { 
          orderId: order._id, 
          status: { $nin: ['Delivered', 'Cancelled', 'Returned'] }
        },
        { 
          status: 'Cancelled',
          cancellationReason: reason || 'Order cancelled by admin',
          $push: {
            statusHistory: {
              status: 'Cancelled',
              updatedBy: req.user.id,
              updatedAt: new Date(),
              reason: reason || 'Order cancelled by admin'
            }
          }
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
        { 
          status: 'Delivered',
          $push: {
            statusHistory: {
              status: 'Delivered',
              updatedBy: req.user.id,
              updatedAt: new Date()
            }
          }
        }
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

module.exports.updateItemStatus = async (req, res) => {
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


    const itemStatusFlow = {
      'Pending': ['Confirmed', 'Cancelled'],
      'Confirmed': ['Processing', 'Cancelled'], 
      'Processing': ['Shipped', 'Cancelled'],
      'Shipped': ['Out for Delivery', 'Delivered', 'Cancelled'],
      'Out for Delivery': ['Delivered', 'Cancelled'],
      'Delivered': ['Cancelled'], 
      'Cancelled': [], 
      'Return Processing': ['Return Approved', 'Cancelled'],
      'Return Approved': ['Returned'],
      'Returned': [] 
    };

  
    const allowedTransitions = itemStatusFlow[orderItem.status] || [];
    
    if (!allowedTransitions.includes(status)) {
      
      if (orderItem.returnRequested && 
          ['Return Processing', 'Return Approved', 'Returned'].includes(status)) {
      
      } else {
        return res.status(400).json({
          success: false,
          error: `Cannot change item status from ${orderItem.status} to ${status}`
        });
      }
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
    
   
    orderItem.statusHistory = orderItem.statusHistory || [];
    orderItem.statusHistory.push({
      status: status,
      updatedBy: req.user.id,
      updatedAt: new Date(),
      reason: reason || null
    });

    
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
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: newOrderStatus,
        updatedBy: 'system',
        updatedAt: new Date(),
        reason: 'Auto-updated based on item statuses'
      });
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

    // Calculate refund amount with proper coupon handling
    const refundAmount = await calculateItemRefundAmount(orderItem.orderId, orderItem);

    // Update item status
    orderItem.status = 'Returned';
    orderItem.isReturned = true;
    orderItem.returnApproved = true;
    orderItem.returnProcessedDate = new Date();

    orderItem.statusHistory.push({
      status: 'Returned',
      updatedBy: adminId,
      updatedAt: new Date(),
      reason: 'Return request approved by admin'
    });

    await orderItem.save();

    // Restore stock to variant
    if (orderItem.variantId) {
      await Variant.findByIdAndUpdate(
        orderItem.variantId._id,
        { $inc: { stock: orderItem.quantity } }
      );
    }

    // Process wallet refund if payment was not COD
    if (orderItem.orderId.paymentMethod !== 'COD' && refundAmount > 0) {
      await processWalletRefund(
        orderItem.orderId.userId, 
        refundAmount, 
        orderItem.orderId._id, 
        'ITEM_RETURN',
        orderItem._id
      );
    }

    res.json({
      success: true,
      message: `Return request approved successfully. ${refundAmount > 0 ? `₹${refundAmount} credited to wallet.` : ''}`,
      item: orderItem,
      refundAmount
    });

  } catch (error) {
    console.error('Approve return error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve return request'
    });
  }
};

// Helper function to calculate item refund amount with coupon consideration
async function calculateItemRefundAmount(order, orderItem) {
  try {
    const itemSubtotal = orderItem.price * orderItem.quantity;
    let refundAmount = itemSubtotal;

    // If order has coupon discount, calculate proportional reduction
    if (order.couponDiscount && order.couponDiscount > 0) {
      // Calculate total items value before discount
      const allItems = await OrderItem.find({ orderId: order._id });
      const totalItemsValue = allItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      
      // Calculate this item's share of the coupon discount
      const itemDiscountShare = (itemSubtotal / totalItemsValue) * order.couponDiscount;
      
      // Subtract the proportional discount from refund amount
      refundAmount = Math.max(0, itemSubtotal - itemDiscountShare);
    }

    return Math.round(refundAmount * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    console.error('Calculate refund amount error:', error);
    return orderItem.price * orderItem.quantity; // Fallback to full item price
  }
}

// Helper function to calculate full order refund amount
async function calculateOrderRefundAmount(order) {
  try {
    let refundAmount = order.total;

    // For full order returns, return the total amount paid
    // Coupon discount is already factored into order.total
    
    return Math.round(refundAmount * 100) / 100;
  } catch (error) {
    console.error('Calculate order refund error:', error);
    return order.total;
  }
}

// Updated wallet refund processing function matching your schema
async function processWalletRefund(userId, amount, orderId, type, itemId = null) {
  try {
    // Find or create user wallet
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

    // Generate unique transaction ID
    const transactionId = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create transaction record matching your schema
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

    // Add amount to wallet balance
    wallet.balance = balanceAfter;
    wallet.transactions.push(transaction);
    
    await wallet.save();

    console.log(`Wallet refund processed: ₹${amount} credited to user ${userId}`);
    
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

// Helper function to generate refund descriptions
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

// Method for approving entire order return
exports.approveOrderReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const adminId = req.session.admin?.id || req.user?.id;

    const order = await Order.findById(orderId).populate('orderItems');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Calculate total refund amount
    const refundAmount = await calculateOrderRefundAmount(order);

    // Update all order items to returned
    await OrderItem.updateMany(
      { orderId: order._id, returnRequested: true },
      { 
        status: 'Returned',
        isReturned: true,
        returnApproved: true,
        returnProcessedDate: new Date(),
        $push: {
          statusHistory: {
            status: 'Returned',
            updatedBy: adminId,
            updatedAt: new Date(),
            reason: 'Return request approved by admin'
          }
        }
      }
    );

    // Restore stock for all items
    const orderItems = await OrderItem.find({ orderId: order._id });
    for (const item of orderItems) {
      if (item.variantId) {
        await Variant.findByIdAndUpdate(
          item.variantId,
          { $inc: { stock: item.quantity } }
        );
      }
    }

    // Update order status
    order.status = 'Returned';
    order.returnApproved = true;
    order.returnProcessedDate = new Date();
    await order.save();

    // Process wallet refund if payment was not COD
    if (order.paymentMethod !== 'COD' && refundAmount > 0) {
      await processWalletRefund(
        order.userId, 
        refundAmount, 
        order._id, 
        'ORDER_RETURN'
      );
    }

    res.json({
      success: true,
      message: `Order return approved successfully. ${refundAmount > 0 ? `₹${refundAmount} credited to wallet.` : ''}`,
      order,
      refundAmount
    });

  } catch (error) {
    console.error('Approve order return error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve order return'
    });
  }
};





exports.rejectReturnRequest = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { reason } = req.body;
    const adminId = req.session.admin?.id || req.user?.id;


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

    orderItem.statusHistory.push({
      status: orderItem.status, 
      updatedBy: adminId,
      updatedAt: new Date(),
      reason: `Return request rejected: ${reason.trim()}`
    });
     console.log(orderItem,"<<<<<<<")
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
      image:(typeof item.productId?.images?.[0] === "string"? item.productId.images[0]: item.productId?.images?.[0]?.url) || '/images/placeholder.png',
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
      deliveryCharge: 0,
      tax: 0
    };

    totals.tax = Math.round(totals.subtotal * 0.18);

    const orderWithProcessedItems = {
      ...order.toObject(),
      items: processedItems,
      orderItems: processedItems
    };

    console.log('Return requests found:', processedItems.filter(item => item.returnRequested).length); // Debug log

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
