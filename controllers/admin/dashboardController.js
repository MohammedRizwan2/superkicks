const mongoose = require('mongoose');
const Order = require('../../models/order');
const User = require('../../models/userSchema');
const Product = require('../../models/product');
const Category = require('../../models/category');
const moment = require('moment');
const PDFDocument = require('pdfkit');

function getDateFilter(period, year, month) {
    let startDate, endDate;
    const now = new Date();

    switch (period) {
        case 'yearly':
            startDate = new Date(year, 0, 1);
            endDate = new Date(year, 11, 31, 23, 59, 59);
            break;
        case 'monthly':
            startDate = new Date(year, month - 1, 1);
            endDate = new Date(year, month, 0, 23, 59, 59);
            break;
        case 'weekly':
            const weekStart = moment().startOf('week').toDate();
            const weekEnd = moment().endOf('week').toDate();
            startDate = weekStart;
            endDate = weekEnd;
            break;
        default:
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    }
    return {
        createdAt: { $gte: startDate, $lte: endDate }
    };
}

exports.getDashboard = async (req, res) => {
    try {

        const period = req.query.period || 'monthly';
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

        console.log('Dashboard params:', { period, year, month });
        const dateFilter = getDateFilter(period, year, month);

        const [
            totalStats,
            salesData,
            bestProducts,
            bestCategories,
            bestBrands,
            latestOrders
        ] = await Promise.all([
            // Total Statistics
            Order.aggregate([
                { $match: { ...dateFilter, status: { $ne: 'Cancelled' } } },
                {
                    $group: {
                        _id: null,
                        totalSales: { $sum: '$total' },
                        totalOrders: { $sum: 1 }
                    }
                }
            ]),

            // Sales Data for Charts
            Order.aggregate([
                { $match: { ...dateFilter, status: { $ne: 'Cancelled' } } },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                            day: { $dayOfMonth: '$createdAt' }
                        },
                        totalSales: { $sum: '$total' },
                        totalOrders: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
                { $limit: 30 }
            ]),

            // Best Selling Products (CORRECTED based on your data)
            Order.aggregate([
                { $match: { status: { $ne: 'Cancelled' } } },
                {
                    $lookup: {
                        from: 'orderitems', // ✅ Correct collection name
                        localField: 'orderItems',
                        foreignField: '_id',
                        as: 'orderItemDetails'
                    }
                },
                { $unwind: '$orderItemDetails' },
                {
                    $group: {
                        _id: '$orderItemDetails.productId',
                        productName: { $first: '$orderItemDetails.productName' }, // ✅ Get from orderitem
                        totalQuantity: { $sum: '$orderItemDetails.quantity' },
                        totalRevenue: {
                            $sum: {
                                $multiply: ['$orderItemDetails.price', '$orderItemDetails.quantity']
                            }
                        }
                    }
                },
                { $sort: { totalQuantity: -1 } },
                { $limit: 10 },
                // Optional: lookup product for brand info
                {
                    $lookup: {
                        from: 'products',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        productName: 1, 
                        brand: { $ifNull: ['$product.brand', 'Unknown'] }, // From product lookup
                        totalQuantity: 1,
                        totalRevenue: 1
                    }
                }
            ]),

            // Best Selling Categories
            Order.aggregate([
                { $match: { status: { $ne: 'Cancelled' } } },
                {
                    $lookup: {
                        from: 'orderitems',
                        localField: 'orderItems',
                        foreignField: '_id',
                        as: 'orderItemDetails'
                    }
                },
                { $unwind: '$orderItemDetails' },
                {
                    $lookup: {
                        from: 'products',
                        localField: 'orderItemDetails.productId',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },

        
                
                {
                    $group: {
                        _id: '$product.categoryId',
                        totalQuantity: { $sum: '$orderItemDetails.quantity' },
                        totalRevenue: {
                            $sum: {
                                $multiply: ['$orderItemDetails.price', '$orderItemDetails.quantity']
                            }
                        }
                    }
                },
                { $match: { _id: { $ne: null } } }, // Filter out null categories
                {
                    $lookup: {
                        from: 'categories',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'category'
                    }
                },
                { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        categoryName: { $ifNull: ['$category.name', 'Unknown'] }, // ✅ Adjust field name
                        totalQuantity: 1,
                        totalRevenue: 1
                    }
                },
                { $sort: { totalQuantity: -1 } },
                { $limit: 10 }
            ]),

            // Best Selling Brands
            Order.aggregate([
                { $match: { status: { $ne: 'Cancelled' } } },
                {
                    $lookup: {
                        from: 'orderitems',
                        localField: 'orderItems',
                        foreignField: '_id',
                        as: 'orderItemDetails'
                    }
                },
                { $unwind: '$orderItemDetails' },
                {
                    $lookup: {
                        from: 'products',
                        localField: 'orderItemDetails.productId',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: '$product.brand',
                        totalQuantity: { $sum: '$orderItemDetails.quantity' },
                        totalRevenue: {
                            $sum: {
                                $multiply: ['$orderItemDetails.price', '$orderItemDetails.quantity']
                            }
                        }
                    }
                },
                { $match: { _id: { $ne: null } } }, // Filter out null brands
                { $sort: { totalQuantity: -1 } },
                { $limit: 10 }
            ]),

            // Latest Orders
            Order.find({})
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('userId', 'name') // ✅ Adjust field name based on your User schema
                .populate({
                    path: 'orderItems',
                    select: 'productName' // ✅ productName is in orderitem
                })
        ]);

        console.log('Aggregation completed successfully');
        console.log('Total Stats:', totalStats);
        console.log('Best Products:', bestProducts?.length || 0);

        const totalStatsObj = totalStats[0] || { totalSales: 0, totalOrders: 0 };
        const totalUsers = await User.countDocuments();

        res.render('admin/dashboard', {
            totalStats: {
                totalSales: totalStatsObj.totalSales || 0,
                totalOrders: totalStatsObj.totalOrders || 0,
                totalUsers: totalUsers || 0,
                totalVisitors: 2500
            },
            salesData: salesData || [],
            bestSellingProducts: bestProducts || [],
            bestSellingCategories: bestCategories || [],
            bestSellingBrands: bestBrands || [],
            latestOrders: latestOrders || [],
            period: period,
            year: year,
            month: month,
            currentYear: new Date().getFullYear(),
            currentMonth: new Date().getMonth() + 1
        });

    } catch (err) {
        console.error("Error in dashboard render:", err);
        
        // Render with default values to prevent EJS errors
        res.render('admin/dashboard', {
            totalStats: {
                totalSales: 0,
                totalOrders: 0,
                totalUsers: 0,
                totalVisitors: 2500
            },
            salesData: [],
            bestSellingProducts: [],
            bestSellingCategories: [],
            bestSellingBrands: [],
            latestOrders: [],
            period: 'monthly',
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            currentYear: new Date().getFullYear(),
            currentMonth: new Date().getMonth() + 1
        });
    }
};

// Generate Ledger function
exports.generateLedger = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const ledgerData = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
                    status: { $ne: 'Cancelled' }
                }
            },
            {
                $group: {
                    _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } },
                    totalSales: { $sum: "$total" },
                    totalOrders: { $sum: 1 },
                    orders: { $push: "$$ROOT" }
                }
            },
            { $sort: { "_id.date": 1 } }
        ]);

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=ledger_${startDate}_to_${endDate}.pdf`);

        doc.pipe(res);
        doc.fontSize(20).text('SUPERKICKS - LEDGER BOOK', { align: 'center' });
        doc.fontSize(12).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown();

        ledgerData.forEach(day => {
            doc.fontSize(14).text(`Date: ${day._id.date}`, { underline: true });
            doc.fontSize(10).text(`Total Sales: Rs ${day.totalSales.toLocaleString('en-IN')}`);
            doc.fontSize(10).text(`Total Orders: ${day.totalOrders}`);
            doc.moveDown(0.5);

            day.orders.forEach(order => {
                doc.fontSize(8).text(`  Order #${order.referenceNo} - Rs ${order.total.toLocaleString('en-IN')} - ${order.status}`);
            });

            doc.moveDown();
        });

        doc.end();

    } catch (error) {
        console.error('Ledger generation error:', error);
        res.status(500).json({ error: 'Failed to generate ledger' });
    }
};
