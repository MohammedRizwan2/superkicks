const express= require ('express');
const router =express.Router();
const adminController= require ('../controllers/admin/adminController');
const customerController= require('../controllers/admin/customerController')
const productController = require('../controllers/admin/productController');
const categoryController = require('../controllers/admin/categoryController');
const orderController = require('../controllers/admin/orderController')
const { uploadProductImages } = require('../config/multer');

const adminAuth = require('../middleware/adminAuth');
// Login routes
router.get('/login', adminController.getAdminLogin);
router.post('/login', adminController.postLogin);



router.use(adminAuth)
router.get('/dashboard', adminController.getDashboard);

// Customers
router.get('/customers', customerController.getUsers);
router.post('/customers/:id/toggle', customerController.toggleBlockStatus);

// Products
router.get('/products', productController.getProducts);
router.get('/products/add', productController.getAddProduct);
router.post('/products/add',uploadProductImages.array('images'), productController.postAddProduct);
router.get('/products/:id/edit', productController.getEditProduct);
router.post('/products/:id/edit',uploadProductImages.array('images'), productController.postEditProduct);
router.post('/products/:id/edit-image', 
  uploadProductImages.single('image'),
  productController.uploadProductImage
);


// Category
router.get('/category', categoryController.getCategories);
router.get('/category/add', categoryController.getAddCategory);
router.post('/category/add', categoryController.postAddCategory);
router.get('/category/:id/edit', categoryController.getEditCategory);
router.post('/category/:id/edit', categoryController.postEditCategory);


router.get('/orders',orderController.renderOrdersPage)
router.get('/api/orders',orderController.listOrder);
router.put('/api/orders/:orderId/status',orderController.updateOrderStatus)
router.put('/api/orders/items/:itemId/status',orderController.updateItemStatus);
router.get('/orders/:orderId',orderController.getOrderDetails);


router.put('/api/orders/items/:itemId/return/approve', orderController.approveReturnRequest);
router.put('/api/orders/items/:itemId/return/reject', orderController.rejectReturnRequest);


router.get('/logout',adminController.logout)

module.exports = router;