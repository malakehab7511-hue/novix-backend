const express = require('express');
const router = express.Router();
const { listDevices, createDevice, updateDevice, removeDevice, heartbeat } = require('../controllers/userDeviceController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', listDevices);
router.post('/', createDevice);
router.post('/heartbeat', heartbeat);          // قبل /:id
router.put('/:id', updateDevice);
router.patch('/:id', updateDevice);
router.delete('/:id', removeDevice);

module.exports = router;
