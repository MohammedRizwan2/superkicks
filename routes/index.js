const express = require('express');
const router = express.Router();
const Product= require('../models/product')
const Category = require('../models/category')
const User = require('../models/userSchema');
const product = require('../models/product');
const {renderHomePage} = require('../controllers/user/homeController')
const {checkUserBlocked} = require('../middleware/checkUserBlocked')
const headerload = require('../middleware/header');



router.get('/',checkUserBlocked,renderHomePage);

module.exports = router;