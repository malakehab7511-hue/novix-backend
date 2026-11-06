const Alert = require('../models/alert');

// جيب كل التنبيهات
const getAllAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find()
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// جيب التنبيهات الغير محلولة
const getActiveAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find({ isResolved: false })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// حل تنبيه معين
const resolveAlert = async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        isResolved: true,
        resolvedAt: new Date()
      },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    // بعت للـ React إن التنبيه اتحل
    global.io.emit('alertResolved', alert);

    res.json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// حل كل التنبيهات النشطة
const resolveAllAlerts = async (req, res) => {
  try {
    const result = await Alert.updateMany(
      { isResolved: false },
      { isResolved: true, resolvedAt: new Date() }
    );
    global.io.emit('alertsResolvedAll', { count: result.modifiedCount });
    res.json({ success: true, count: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllAlerts,
  getActiveAlerts,
  resolveAlert,
  resolveAllAlerts
};