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
        limit = 50
      } = req.query;

      console.log('Query params:', req.query); // Debug log

    
      const dateRange = SalesReportController.calculateDateRange(reportType, startDate, endDate);
      
    
      const pipeline = SalesReportController.buildSalesAggregationPipeline(dateRange, parseInt(page), parseInt(limit));
      
      // Execute aggregation
      const [reportData, totalCount] = await Promise.all([
        Order.aggregate(pipeline),
        SalesReportController.getTotalOrdersCount(dateRange)
      ]);

    
      const summaryMetrics = await SalesReportController.calculateSummaryMetrics(dateRange);

      // Prepare response
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
      
    
      doc.fontSize(20).text('SUPERKICKS - Sales Report', { align: 'center' });
      doc.fontSize(14).text(`Report Period: ${dateRange.start.toDateString()} to ${dateRange.end.toDateString()}`, { align: 'center' });
      doc.moveDown();

      
      doc.fontSize(16).text('Summary', { underline: true });
      doc.fontSize(12);
      doc.text(`Total Orders: ${reportData.summary.totalOrders}`);
      doc.text(`Total Sales Amount: ₹${reportData.summary.totalSalesAmount.toLocaleString('en-IN')}`);
      doc.text(`Total Discounts Given: ₹${reportData.summary.totalDiscounts.toLocaleString('en-IN')}`);
      doc.text(`Average Order Value: ₹${reportData.summary.averageOrderValue.toLocaleString('en-IN')}`);
      doc.moveDown();

      // Orders table
      reportData.orders.forEach((order, index) => {
        const y = doc.y;
        doc.text(`${order.referenceNo} - ₹${order.total.toLocaleString('en-IN')}`, 50, y);
        doc.moveDown(0.5);
      });

      doc.end();

    } catch (error) {
      console.error('PDF download error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate PDF report' });
    }
  }

  // Download sales report as Excel
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
      
    
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.addRow(['Sales Report Summary']);
      summarySheet.addRow(['Report Period:', `${dateRange.start.toDateString()} to ${dateRange.end.toDateString()}`]);
      summarySheet.addRow([]);
      summarySheet.addRow(['Metric', 'Value']);
      summarySheet.addRow(['Total Orders', reportData.summary.totalOrders]);
      summarySheet.addRow(['Total Sales Amount', `₹${reportData.summary.totalSalesAmount.toLocaleString('en-IN')}`]);
      summarySheet.addRow(['Total Discounts Given', `₹${reportData.summary.totalDiscounts.toLocaleString('en-IN')}`]);
      summarySheet.addRow(['Average Order Value', `₹${reportData.summary.averageOrderValue.toLocaleString('en-IN')}`]);

    
      const ordersSheet = workbook.addWorksheet('Orders');
      ordersSheet.addRow([
        'Order ID', 'Reference No', 'Order Date', 'Customer', 'Status', 
        'Payment Method', 'Subtotal', 'Discounts', 'Total Amount', 'Items Count'
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
          order.totalDiscount || 0,
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
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'customer'
        }
      },
      
    
      {
        $addFields: {
          customerName: { $arrayElemAt: ['$customer.fullName', 0] },
          productOffers: { $ifNull: ['$offerDiscount', 0] },
          couponDiscount: { $ifNull: ['$coupon.discountAmount', 0] },
          totalDiscount: {
            $add: [
              { $ifNull: ['$offerDiscount', 0] },
              { $ifNull: ['$coupon.discountAmount', 0] }
            ]
          }
        }
      },
      
      
      {
        $project: {
          _id: 1,
          referenceNo: 1,
          orderDate: 1,
          customerName: 1,
          status: 1,
          paymentMethod: 1,
          total: 1,
          subtotal: { $ifNull: ['$subtotal', 0] },
          deliveryCharge: { $ifNull: ['$deliveryCharge', 0] },
          tax: { $ifNull: ['$tax', 0] },
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
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSalesAmount: { $sum: '$total' },
          totalProductOffers: { $sum: { $ifNull: ['$offerDiscount', 0] } },
          totalCouponDiscounts: { $sum: { $ifNull: ['$coupon.discountAmount', 0] } },
          averageOrderValue: { $avg: '$total' }
        }
      },
      {
        $addFields: {
          totalDiscounts: {
            $add: ['$totalProductOffers', '$totalCouponDiscounts']
          }
        }
      }
    ];

    const result = await Order.aggregate(pipeline);
    
    if (result.length === 0) {
      return {
        totalOrders: 0,
        totalSalesAmount: 0,
        totalProductOffers: 0,
        totalCouponDiscounts: 0,
        totalDiscounts: 0,
        averageOrderValue: 0
      };
    }

    return {
      totalOrders: result[0].totalOrders,
      totalSalesAmount: Math.round(result[0].totalSalesAmount * 100) / 100,
      totalProductOffers: Math.round(result[0].totalProductOffers * 100) / 100,
      totalCouponDiscounts: Math.round(result[0].totalCouponDiscounts * 100) / 100,
      totalDiscounts: Math.round(result[0].totalDiscounts * 100) / 100,
      averageOrderValue: Math.round(result[0].averageOrderValue * 100) / 100
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

// Export functions correctly
module.exports = {
  renderSalesReportPage: SalesReportController.renderSalesReportPage,
  generateSalesReport: SalesReportController.generateSalesReport,
  downloadPDF: SalesReportController.downloadPDF,
  downloadExcel: SalesReportController.downloadExcel
};
