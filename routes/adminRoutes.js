const express= require ('express');
const router =express.Router();
const adminController= require ('../controllers/admin/adminController');
const customerController= require('../controllers/admin/customerController')
const productController = require('../controllers/admin/productController');
const categoryController = require('../controllers/admin/categoryController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

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
router.post('/products/add', upload.array('images', 10), productController.postAddProduct);
router.get('/products/:id/edit', productController.getEditProduct);
router.post('/products/:id/edit', upload.array('images', 10), productController.postEditProduct);

// Category
router.get('/category', categoryController.getCategories);
router.get('/category/add', categoryController.getAddCategory);
router.post('/category/add', categoryController.postAddCategory);
router.get('/category/:id/edit', categoryController.getEditCategory);
router.post('/category/:id/edit', categoryController.postEditCategory);


router.get('/logout',adminController.logout)

module.exports = router;