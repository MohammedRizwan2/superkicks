const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem')
const Variant = require('../../models/variant');
const Product = require('../../models/product');
const User = require('../../models/userSchema');


exports.listOrder = async (req , res)=>{
    try{
      const {page = 1,limit=10,search='',status='all',sortBy='orderDate',order='desc'}=req.query;

      const skip= (page-1)* limit;

      let query ={};

      if(search){
        const user = await User.find({
            $or:[
                {fullName:{$regax:search,$options:'i' }},
                {email:{$regax:search,$options:'i'}},
                {phone:{$regax:search,$options:'i'}}
            ]
        }).select('_id');

        query = {
            $or:[
                {referenceNo:{regax:search,$options:'i'}},
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
exports.getOrderDetails = async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    console.log(orderId)

    // Fetch the order with proper population based on your schema
    const order = await Order.findById(orderId)
      .populate('userId', 'fullName email phone')
      .populate({
        path: 'orderItems',
        populate: [
          {
            path: 'productId',
            model: 'Product',
            select: 'name images brand category'
          },
          {
            path: 'variantId', 
            model: 'Variant',
            select: 'size color price stock'
          }
        ]
      });

    if (!order) {
        console.log("order not found")
      return res.status(404).render('error/404', { message: 'Order not found' });
    }

    // Process order items with proper data extraction
    const processedItems = order.orderItems.map(item => ({
      id: item._id,
      productName: item.productName, // This is stored directly in OrderItem
      image: item.productId?.images?.[0] || '/images/placeholder.png',
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
      brand: item.productId?.brand || 'N/A',
      category: item.productId?.category || 'N/A'
    }));

    // Calculate totals
    const subtotal = order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryCharge = subtotal >= 2999 ? 0 : 129;
    const tax = subtotal * 0.18;

    res.render('admin/orderDetails', {
      order: {
        id: order._id,
        referenceNo: order.referenceNo,
        orderDate: order.orderDate,
        status: order.status,
        paymentMethod: order.paymentMethod,
        total: order.total,
        address: order.address,
        cancellationReason: order.cancellationReason || null,
        user: {
          id: order.userId?._id,
          name: order.userId?.fullName || 'N/A',
          email: order.userId?.email || 'N/A',
          phone: order.userId?.phone || 'N/A'
        },
        items: processedItems,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      },
      totals: {
        subtotal,
        deliveryCharge,
        tax,
        total: order.total
      }
    });

  } catch (error) {
    console.error('Admin order details error:', error);
    next(error);
  }
};


exports.updateOrderStatusAPI = async (req, res) => {
  try {
    const orderId = req.params.orderId;
  
    const { status } = req.body;

    const validStatuses = ['Pending', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
    
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

    const oldStatus = order.status;
    order.status = status;


    await OrderItem.updateMany(
      { _id: { $in: order.orderItems } },
      { status: status }
    );

    await order.save();

    // Inventory management
    if (oldStatus !== 'Shipped' && status === 'Shipped') {
      for (const itemId of order.orderItems) {
        const item = await OrderItem.findById(itemId);
        if (item && item.variantId) {
          const variant = await Variant.findById(item.variantId);
          if (variant && variant.stock >= item.quantity) {
            variant.stock -= item.quantity;
            await variant.save();
          }
        }
      }
    }
    
    
    if (oldStatus !== 'Cancelled' && status === 'Cancelled') {
      for (const itemId of order.orderItems) {
        const item = await OrderItem.findById(itemId);
        if (item && item.variantId) {
          const variant = await Variant.findById(item.variantId);
          if (variant) {
            variant.stock += item.quantity;
            await variant.save();
          }
        }
      }
    }

    return res.json({
      success: true,
      message: `Order status updated from ${oldStatus} to ${status}`,
      data: {
        orderId: order._id,
        status: order.status,
        oldStatus,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error('Update order status API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update order status'
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