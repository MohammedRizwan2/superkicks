const Order = require('../../models/order');
const Variant = require('../../models/variant');
const OrderItem= require('../../models/orderItem')
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');



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
      returnRequestDate: order.returnRequestDate
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




// Cancel entire order (user side) - Updated
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

    // Update order status
    order.status = 'Cancelled';
    order.isCancelled = true;
    if (reason) {
      order.cancellationReason = reason;
    }

    // Update order items
    for (const itemId of order.orderItems) {
      const orderItem = await OrderItem.findById(itemId);
      if (orderItem && !orderItem.isCancelled) {
        orderItem.status = 'Cancelled';
        orderItem.isCancelled = true;
        if (reason) {
          orderItem.cancellationReason = reason;
        }
        
        // ADD: Set statusHistory if it exists (for admin compatibility)
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

    return res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: {
        orderId: order._id,
        status: order.status,
        cancellationReason: order.cancellationReason
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

// Cancel specific order item (user side) - Updated
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

    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const orderItem = await OrderItem.findById(itemId);
    if (!orderItem || !order.orderItems.includes(itemId)) {
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

    // Cancel the item
    orderItem.status = 'Cancelled';
    orderItem.isCancelled = true;
    if (reason) {
      orderItem.cancellationReason = reason;
    }
    
    // ADD: Set statusHistory if it exists (for admin compatibility)
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

    return res.json({
      success: true,
      message: 'Item cancelled successfully',
      data: {
        itemId: orderItem._id,
        status: orderItem.status,
        cancellationReason: orderItem.cancellationReason,
        orderStatus: allCancelled ? 'Cancelled' : order.status
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

// Request return (user side) - Updated
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

    if (order.status !== 'Delivered' || order.isReturned) {
      return res.status(400).json({
        success: false,
        error: 'Only delivered orders can be returned'
      });
    }

    // Check return window
    const deliveryDate = new Date(order.updatedAt);
    const returnWindow = 7 * 24 * 60 * 60 * 1000; 
    const now = new Date();
    
    if (now - deliveryDate > returnWindow) {
      return res.status(400).json({
        success: false,
        error: 'Return window has expired (7 days from delivery)'
      });
    }

    // Update order
    order.status = 'Return Requested';
    order.isReturned = true;
    order.returnReason = reason.trim();
    order.returnRequestDate = new Date();

    // Update order items
    for (const itemId of order.orderItems) {
      const orderItem = await OrderItem.findById(itemId);
      if (orderItem) {
        orderItem.status = 'Return Requested';
        orderItem.isReturned = true;
        orderItem.returnReason = reason.trim();
        orderItem.returnRequestDate = new Date();
        
        // ADD: Set returnRequested flag for admin compatibility
        orderItem.returnRequested = true;
        
        // ADD: Set statusHistory if it exists (for admin compatibility)
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
      message: 'Return request submitted successfully',
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


//Search ordersss
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
////orderdetail pageeee
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

    const subtotal = order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryCharge = subtotal >= 2999 ? 0 : 129;
    const tax = subtotal * 0.18;
    const total = subtotal + tax + deliveryCharge;

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
        items: order.orderItems.map(item => ({
          id: item._id,
          productName: item.productName,
          productId: item.productId?._id,
          variantId: item.variantId?._id,
          size: item.variantId?.size || 'N/A',
          price: item.price,
          quantity: item.quantity,
          status: item.status,
          itemTotal: item.price * item.quantity,
          image: (
  typeof item.productId?.images?.[0] === "string"? item.productId.images[0]: item.productId?.images?.[0]?.url) || '/images/placeholder.png'
        }))
      },
      totals: {
        subtotal,
        deliveryCharge,
        tax,
        total
      }
    });

  } catch (error) {
    console.error('Order details error:', error);
    next(error);
  }
};






///invoiceeee
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
    const { orderId, itemId } = req.params;
    const { reason } = req.body;
    const userId = req.session.user?.id || req.user?.id;

    console.log('Return item request:', { orderId, itemId, userId, reason }); // Debug log

    // Validate input
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Return reason is required and must be at least 10 characters long'
      });
    }

    // Find the order and populate orderItems
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
    }); // Debug log

    // Find the specific order item
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
      isCancelled: orderItem.isCancelled
    }); // Debug log

    // Check if item can be returned
    if (orderItem.status !== 'Delivered') {
      return res.status(400).json({
        success: false,
        error: 'Item must be delivered before it can be returned'
      });
    }

    if (orderItem.isReturned || orderItem.isCancelled) {
      return res.status(400).json({
        success: false,
        error: 'Item has already been returned or cancelled'
      });
    }

    // Update the order item directly in the database
    await OrderItem.findByIdAndUpdate(itemId, {
      isReturned: true,
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

    console.log('Order item updated successfully'); 

    
    const updatedOrder = await Order.findById(orderId).populate('orderItems');
    const allItemsReturnedOrCancelled = updatedOrder.orderItems.every(item => 
      item.isReturned || item.isCancelled
    );

    
    if (allItemsReturnedOrCancelled) {
      await Order.findByIdAndUpdate(orderId, {
        status: 'Return Requested',
        isReturned: true
      });
      console.log('Order status updated to Return Requested'); // Debug log
    }

    res.json({
      success: true,
      message: 'Item return request submitted successfully. We will process your request soon.'
    });

  } catch (error) {
    console.error('Return item error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process return request. Please try again.'
    });
  }
};
