const Order = require('../../models/order');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

class SalesReportController {

  static async renderSalesReportPage(req, res) {
    try {
      res.render('admin/salesReport', {
        title: 'Sales Report - Admin Dashboard'
      });
    } catch (error) {
      console.error('Render sales report error:', error);
      res.status(500).render('error/500', { message: 'Failed to load sales report page' });
    }
  }

  
  static async generateSalesReport(req, res) {
    try {
      const {
        reportType = 'custom',
        startDate,
        endDate,
        page = 1,
        limit = 10,
      } = req.query;

      console.log('Query params:', req.query);

   
      const dateRange = SalesReportController.calculateDateRange(reportType, startDate, endDate);
      
     
       const pipeline = SalesReportController.buildSalesAggregationPipeline(dateRange, parseInt(page), parseInt(limit))
      
      
      const [reportData, totalCount] = await Promise.all([
        Order.aggregate(pipeline),
        SalesReportController.getTotalOrdersCount(dateRange)
      ]);

     
      const summaryMetrics = await SalesReportController.calculateSummaryMetrics(dateRange);
 console.log(reportData,"<<<");
 console.log(summaryMetrics,"summereeerrr")
    
      const response = {
        success: true,
        data: {
          reportType,
          dateRange,
          summary: summaryMetrics,
          orders: reportData,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalOrders: totalCount,
            limit: parseInt(limit),
            hasNext: page < Math.ceil(totalCount / parseInt(limit)),
            hasPrev: page > 1
          }
        }
      };

      res.json(response);

    } catch (error) {
      console.error('Generate sales report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate sales report'
      });
    }
  }

  // Download PDF report
  static async downloadPDF(req, res) {
    try {
      const {
        reportType = 'custom',
        startDate,
        endDate
      } = req.query;

      const dateRange = SalesReportController.calculateDateRange(reportType, startDate, endDate);
      const reportData = await SalesReportController.getSalesReportData(dateRange);
      
      const doc = new PDFDocument();
      const filename = `sales-report-${Date.now()}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      
      doc.pipe(res);
      
      // PDF Header
      doc.fontSize(20).text('SUPERKICKS - Sales Report', { align: 'center' });
      doc.fontSize(14).text(`Report Period: ${dateRange.start.toDateString()} to ${dateRange.end.toDateString()}`, { align: 'center' });
      doc.moveDown();

      // Summary section
      doc.fontSize(16).text('Summary', { underline: true });
      doc.fontSize(12);
      doc.text(`Total Orders: ${reportData.summary.totalOrders}`);
      doc.text(`Total Sales Amount: Rs ${reportData.summary.totalSalesAmount.toLocaleString('en-IN')}`);
      doc.text(`Total Product Offers: Rs ${reportData.summary.totalProductOffers.toLocaleString('en-IN')}`);
      doc.text(`Total Coupon Discounts: Rs ${reportData.summary.totalCouponDiscounts.toLocaleString('en-IN')}`);
      doc.text(`Total Discounts: Rs ${reportData.summary.totalDiscounts.toLocaleString('en-IN')}`);
      doc.text(`Average Order Value: Rs ${reportData.summary.averageOrderValue.toLocaleString('en-IN')}`);
      doc.moveDown();

      // Orders table
      doc.fontSize(14).text('Orders Details', { underline: true });
      doc.fontSize(10);
      reportData.orders.forEach((order, index) => {
        doc.text(`${order.referenceNo} - ${order.customerName} - Rs ${order.total.toLocaleString('en-IN')} - ${order.status}`);
        doc.moveDown(0.3);
      });

      doc.end();

    } catch (error) {
      console.error('PDF download error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate PDF report' });
    }
  }

  // Download Excel report
  static async downloadExcel(req, res) {
    try {
      const {
        reportType = 'custom',
        startDate,
        endDate
      } = req.query;

      const dateRange = SalesReportController.calculateDateRange(reportType, startDate, endDate);
      const reportData = await SalesReportController.getSalesReportData(dateRange);
      
      const workbook = new ExcelJS.Workbook();
      
      // Summary sheet
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.addRow(['Sales Report Summary']);
      summarySheet.addRow(['Report Period:', `${dateRange.start.toDateString()} to ${dateRange.end.toDateString()}`]);
      summarySheet.addRow([]);
      summarySheet.addRow(['Metric', 'Value']);
      summarySheet.addRow(['Total Orders', reportData.summary.totalOrders]);
      summarySheet.addRow(['Total Sales Amount', `Rs ${reportData.summary.totalSalesAmount.toLocaleString('en-IN')}`]);
      summarySheet.addRow(['Total Product Offers', `Rs ${reportData.summary.totalProductOffers.toLocaleString('en-IN')}`]);
      summarySheet.addRow(['Total Coupon Discounts', `Rs ${reportData.summary.totalCouponDiscounts.toLocaleString('en-IN')}`]);
      summarySheet.addRow(['Total Discounts', `Rs ${reportData.summary.totalDiscounts.toLocaleString('en-IN')}`]);
      summarySheet.addRow(['Average Order Value', `Rs ${reportData.summary.averageOrderValue.toLocaleString('en-IN')}`]);

      // Orders sheet
      const ordersSheet = workbook.addWorksheet('Orders');
      ordersSheet.addRow([
        'Order ID', 'Reference No', 'Order Date', 'Customer', 'Status', 
        'Payment Method', 'Subtotal', 'Product Offers', 'Coupon Discount', 'Total Amount', 'Items Count'
      ]);

      reportData.orders.forEach(order => {
        ordersSheet.addRow([
          order._id.toString(),
          order.referenceNo,
          new Date(order.orderDate).toLocaleDateString('en-IN'),
          order.customerName || 'N/A',
          order.status,
          order.paymentMethod,
          order.subtotal || 0,
          order.productOffers || 0,
          order.couponDiscount || 0,
          order.total,
          order.itemCount || 0
        ]);
      });

      const filename = `sales-report-${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error('Excel download error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate Excel report' });
    }
  }

  // Calculate date range based on report type
  static calculateDateRange(reportType, startDate, endDate) {
    const now = new Date();
    let start, end;

    switch (reportType) {
      case 'daily':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(start);
        end.setDate(end.getDate() + 1);
        break;
        
      case 'weekly':
        const dayOfWeek = now.getDay();
        start = new Date(now);
        start.setDate(now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        break;
        
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
        
      case 'yearly':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear() + 1, 0, 1);
        break;
        
      case 'custom':
      default:
        start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
        end = endDate ? new Date(endDate) : new Date();
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }

  // Build aggregation pipeline for sales data (using your existing offerDiscount field)
  static buildSalesAggregationPipeline(dateRange, page, limit) {
    const skip = (page - 1) * limit;
    
    return [
      {
        $match: {
          orderDate: {
            $gte: dateRange.start,
            $lte: dateRange.end
          },
          status: { $ne: 'Cancelled' }
        }
      },
      
      
      {
        $lookup: {
          from: 'orderitems',
          localField: 'orderItems',
          foreignField: '_id',
          as: 'orderItemDetails'
        }
      },
      
      
      {
        $addFields: {
          customerName: '$address.name',
          
          
          productOffers: {
            $sum: {
              $map: {
                input: '$orderItemDetails',
                in: { $multiply: ['$$this.offerDiscount', '$$this.quantity'] }
              }
            }
          },
          
          
          couponDiscount: { $ifNull: ['$coupon.discountAmount', 0] },
          
       
          totalDiscount: {
            $add: [
              {
                $sum: {
                  $map: {
                    input: '$orderItemDetails',
                    in: { $multiply: ['$$this.offerDiscount', '$$this.quantity'] }
                  }
                }
              },
              { $ifNull: ['$coupon.discountAmount', 0] }
            ]
          },
          
         
          subtotal: {
            $add: [
              '$total',
              {
                $sum: {
                  $map: {
                    input: '$orderItemDetails',
                    in: { $multiply: ['$$this.offerDiscount', '$$this.quantity'] }
                  }
                }
              },
              { $ifNull: ['$coupon.discountAmount', 0] }
            ]
          }
        }
      },
      
      // Project required fields
      {
        $project: {
          _id: 1,
          referenceNo: 1,
          orderDate: 1,
          customerName: 1,
          status: 1,
          paymentMethod: 1,
          total: 1,
          subtotal: 1,
          productOffers: 1,
          couponDiscount: 1,
          totalDiscount: 1,
          itemCount: { $size: { $ifNull: ['$orderItems', []] } }
        }
      },
      
      // Sort by order date (newest first)
      { $sort: { orderDate: -1 } },
      
      // Pagination
      { $skip: skip },
      { $limit: limit }
    ];
  }

  static async calculateSummaryMetrics(dateRange) {
  const pipeline = [

    {
      $match: {
        orderDate: {
          $gte: dateRange.start,
          $lte: dateRange.end
        },
        status: { $ne: 'Cancelled' }
      }
    },
    
  
    {
      $lookup: {
        from: 'orderitems',
        localField: 'orderItems',
        foreignField: '_id',
        as: 'orderItemDetails'
      }
    },
    
    // Calculate product offers per order using $reduce
    {
      $addFields: {
        orderProductOffers: {
          $reduce: {
            input: { $ifNull: ['$orderItemDetails', []] },
            initialValue: 0,
            in: {
              $add: [
                '$$value',
                { $multiply: [
                    { $ifNull: ['$$this.offerDiscount', 0] },
                    { $ifNull: ['$$this.quantity', 1] }
                  ]
                }
              ]
            }
          }
        },
        
        // Calculate subtotal per order (before any discounts)
        orderSubtotal: {
          $reduce: {
            input: { $ifNull: ['$orderItemDetails', []] },
            initialValue: 0,
            in: {
              $add: [
                '$$value',
                { $multiply: [
                    { $add: [
                        { $ifNull: ['$$this.price', 0] },
                        { $ifNull: ['$$this.offerDiscount', 0] }
                      ]
                    },
                    { $ifNull: ['$$this.quantity', 1] }
                  ]
                }
              ]
            }
          }
        }
      }
    },
    
    // Group all orders to calculate totals
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSalesAmount: { $sum: '$total' },
        totalSubtotalAmount: { $sum: '$orderSubtotal' },
        totalProductOffers: { $sum: '$orderProductOffers' },
        totalCouponDiscounts: { $sum: { $ifNull: ['$coupon.discountAmount', 0] } },
        averageOrderValue: { $avg: '$total' },
        
        // Additional metrics
        minOrderValue: { $min: '$total' },
        maxOrderValue: { $max: '$total' },
        totalItemsCount: {
          $sum: { $size: { $ifNull: ['$orderItems', []] } }
        }
      }
    },
    
    // Add calculated fields
    {
      $addFields: {
        totalDiscounts: {
          $add: ['$totalProductOffers', '$totalCouponDiscounts']
        },
        
        // Discount percentage of total sales
        discountPercentage: {
          $cond: {
            if: { $gt: ['$totalSubtotalAmount', 0] },
            then: {
              $multiply: [
                { $divide: [
                    { $add: ['$totalProductOffers', '$totalCouponDiscounts'] },
                    '$totalSubtotalAmount'
                  ]
                },
                100
              ]
            },
            else: 0
          }
        },
        
        // Average items per order
        averageItemsPerOrder: {
          $cond: {
            if: { $gt: ['$totalOrders', 0] },
            then: { $divide: ['$totalItemsCount', '$totalOrders'] },
            else: 0
          }
        }
      }
    }
  ];

  const result = await Order.aggregate(pipeline);
  
  // Handle empty result
  if (result.length === 0) {
    return {
      totalOrders: 0,
      totalSalesAmount: 0,
      totalSubtotalAmount: 0,
      totalProductOffers: 0,
      totalCouponDiscounts: 0,
      totalDiscounts: 0,
      averageOrderValue: 0,
      minOrderValue: 0,
      maxOrderValue: 0,
      discountPercentage: 0,
      averageItemsPerOrder: 0,
      totalItemsCount: 0
    };
  }

  const data = result[0];
  
  // Return properly rounded values
  return {
    totalOrders: data.totalOrders || 0,
    totalSalesAmount: Math.round((data.totalSalesAmount || 0) * 100) / 100,
    totalSubtotalAmount: Math.round((data.totalSubtotalAmount || 0) * 100) / 100,
    totalProductOffers: Math.round((data.totalProductOffers || 0) * 100) / 100,
    totalCouponDiscounts: Math.round((data.totalCouponDiscounts || 0) * 100) / 100,
    totalDiscounts: Math.round((data.totalDiscounts || 0) * 100) / 100,
    averageOrderValue: Math.round((data.averageOrderValue || 0) * 100) / 100,
    minOrderValue: Math.round((data.minOrderValue || 0) * 100) / 100,
    maxOrderValue: Math.round((data.maxOrderValue || 0) * 100) / 100,
    discountPercentage: Math.round((data.discountPercentage || 0) * 100) / 100,
    averageItemsPerOrder: Math.round((data.averageItemsPerOrder || 0) * 100) / 100,
    totalItemsCount: data.totalItemsCount || 0
  };
}


  
  static async getTotalOrdersCount(dateRange) {
    return await Order.countDocuments({
      orderDate: {
        $gte: dateRange.start,
        $lte: dateRange.end
      },
      status: { $ne: 'Cancelled' }
    });
  }


  static async getSalesReportData(dateRange) {
    const pipeline = SalesReportController.buildSalesAggregationPipeline(dateRange, 1, 100000);
    const [orders, summary] = await Promise.all([
      Order.aggregate(pipeline),
      SalesReportController.calculateSummaryMetrics(dateRange)
    ]);

    return { orders, summary };
  }
}


module.exports = {
  renderSalesReportPage: SalesReportController.renderSalesReportPage,
  generateSalesReport: SalesReportController.generateSalesReport,
  downloadPDF: SalesReportController.downloadPDF,
  downloadExcel: SalesReportController.downloadExcel
};
