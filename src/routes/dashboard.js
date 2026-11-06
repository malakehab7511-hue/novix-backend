const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

// جيب كل بيانات الداشبورد (لازم تسجيل دخول)
router.get('/', protect, getDashboardData);

module.exports = router;
