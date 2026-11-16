const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../controllers/dashboardController');
const { protect, optionalAuth } = require('../middleware/auth');

// جيب كل بيانات الداشبورد (لازم تسجيل دخول)
router.get('/', optionalAuth, getDashboardData);

module.exports = router;
