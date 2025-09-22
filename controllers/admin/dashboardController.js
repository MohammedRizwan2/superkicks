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
                        categoryName: { $ifNull: ['$category.name', 'Unknown'] }, 
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

        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ 
            margin: 50,
            bufferPages: true // Important: prevent immediate page flushing
        });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=ledger_${startDate}_to_${endDate}.pdf`);
        doc.pipe(res);

        // Page dimensions
        const pageHeight = doc.page.height;
        const margin = 50;
        const usableHeight = pageHeight - (margin * 2);
        const bottomMargin = pageHeight - margin;

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('SUPERKICKS - LEDGER BOOK', { align: 'center' });
        doc.fontSize(14).font('Helvetica').text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown(2);

        // Calculate totals
        const grandTotal = ledgerData.reduce((sum, day) => sum + day.totalSales, 0);
        const totalOrdersCount = ledgerData.reduce((sum, day) => sum + day.totalOrders, 0);

        // Summary section
        doc.fontSize(16).font('Helvetica-Bold').text('SUMMARY', { underline: true });
        doc.moveDown(0.5);
        
        doc.fontSize(12).font('Helvetica');
        doc.text('Total Revenue:', 50, doc.y);
        doc.text(`Rs ${grandTotal.toLocaleString('en-IN')}`, 200, doc.y - 12);
        doc.text('Total Orders:', 50, doc.y);
        doc.text(`${totalOrdersCount}`, 200, doc.y - 12);
        
        doc.moveDown(2);

        // Main table header
        doc.fontSize(16).font('Helvetica-Bold').text('DAILY BREAKDOWN', { underline: true });
        doc.moveDown(1);

        ledgerData.forEach((day, dayIndex) => {
            // Calculate space needed for this day's content
            const ordersCount = day.orders.length;
            const spaceNeeded = 80 + (ordersCount * 20) + 25; // Header + orders + total row

            // Check if we need a new page BEFORE starting this section
            if (doc.y + spaceNeeded > bottomMargin) {
                doc.addPage();
            }

            // Day header
            const dayHeaderY = doc.y;
            doc.fontSize(14).font('Helvetica-Bold')
               .fillColor('#2563eb')
               .text(`${day._id.date}`, 50, dayHeaderY);
            
            doc.fontSize(10).font('Helvetica')
               .fillColor('#666666')
               .text(`Daily Total: Rs ${day.totalSales.toLocaleString('en-IN')} | Orders: ${day.totalOrders}`, 200, dayHeaderY);
            
            doc.moveDown(0.5);

            // Table headers for orders
            const tableTop = doc.y;
            const orderNoX = 50;
            const referenceX = 120;
            const statusX = 220;
            const amountX = 300;
            const customerX = 380;

            // Draw header background
            doc.rect(50, tableTop - 5, 492, 25).fillAndStroke('#f3f4f6', '#d1d5db');
            
            // Header text
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151');
            doc.text('S.No', orderNoX, tableTop);
            doc.text('Order Ref', referenceX, tableTop);
            doc.text('Status', statusX, tableTop);
            doc.text('Amount (Rs)', amountX, tableTop);
            doc.text('Customer', customerX, tableTop);

            // Set Y position for order rows
            doc.y = tableTop + 25;

            // Order rows
            day.orders.forEach((order, orderIndex) => {
                const currentY = doc.y;

                // Alternate row background
                if (orderIndex % 2 === 0) {
                    doc.rect(50, currentY - 3, 492, 20).fill('#f9fafb');
                }

                doc.fontSize(9).font('Helvetica').fillColor('#111827');
                
                // Order data
                doc.text(`${orderIndex + 1}`, orderNoX, currentY);
                doc.text(order.referenceNo || 'N/A', referenceX, currentY);
                
                // Status with color coding
                const statusColor = getStatusColor(order.status);
                doc.fillColor(statusColor).text(order.status, statusX, currentY);
                
                doc.fillColor('#111827').text(order.total.toLocaleString('en-IN'), amountX, currentY);
                
                // Customer name (truncated if too long)
                const customerName = order.address?.name || 'Guest';
                const truncatedName = customerName.length > 15 ? customerName.substring(0, 15) + '...' : customerName;
                doc.text(truncatedName, customerX, currentY);

                // Move to next row
                doc.y = currentY + 20;
            });

            // Day total row
            const totalRowY = doc.y;
            doc.rect(50, totalRowY, 492, 25).fillAndStroke('#e5e7eb', '#9ca3af');
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#1f2937');
            doc.text('Daily Total:', referenceX, totalRowY + 5);
            doc.text(`Rs ${day.totalSales.toLocaleString('en-IN')}`, amountX, totalRowY + 5);
            doc.text(`${day.totalOrders} orders`, customerX, totalRowY + 5);

            // Set Y position after total row
            doc.y = totalRowY + 35; // 25 for row height + 10 for spacing
        });

        // Check if we need a new page for grand total
        if (doc.y + 60 > bottomMargin) {
            doc.addPage();
        }

        // Grand total footer
        const grandTotalY = doc.y + 10;
        doc.rect(50, grandTotalY, 492, 30).fillAndStroke('#1f2937', '#111827');
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('GRAND TOTAL:', 200, grandTotalY + 8);
        doc.text(`Rs ${grandTotal.toLocaleString('en-IN')}`, 300, grandTotalY + 8);
        doc.text(`${totalOrdersCount} Total Orders`, 380, grandTotalY + 8);

        // Footer
        doc.fontSize(8).fillColor('#6b7280').text(
            `Generated on: ${new Date().toLocaleString('en-IN')} | SuperKicks Admin Panel`,
            50, doc.page.height - 30,
            { align: 'center' }
        );

        doc.end();

    } catch (error) {
        console.error('Ledger generation error:', error);
        res.status(500).json({ error: 'Failed to generate ledger' });
    }
};

// Helper function for status colors
function getStatusColor(status) {
    switch (status?.toLowerCase()) {
        case 'delivered':
            return '#10b981'; // green
        case 'shipped':
        case 'out for delivery':
            return '#3b82f6'; // blue
        case 'cancelled':
            return '#ef4444'; // red
        case 'pending':
            return '#f59e0b'; // yellow
        case 'confirmed':
        case 'processing':
            return '#8b5cf6'; // purple
        default:
            return '#6b7280'; // gray
    }
}
