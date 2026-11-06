const SensorData = require('../models/sensorData');
const Alert = require('../models/alert');

// جيب كل بيانات الداشبورد
const getDashboardData = async (req, res) => {
  try {
    // آخر قراءة
    const latestReading = await SensorData.findOne()
      .sort({ createdAt: -1 });

    // آخر 60 قراءة للـ Chart
    const chartData = await SensorData.find()
      .sort({ createdAt: -1 })
      .limit(60)
      .select('mq2 mq6 flame temperature humidity riskPercentage createdAt');

    // عدد التنبيهات النشطة
    const activeAlertsCount = await Alert.countDocuments({
      isResolved: false
    });

    // إحصائيات مستويات الخطر
    const totalReadings = await SensorData.countDocuments();
    const dangerCount = await SensorData.countDocuments({ riskLevel: 'danger' });
    const warningCount = await SensorData.countDocuments({ riskLevel: 'warning' });
    const safeCount = await SensorData.countDocuments({ riskLevel: 'safe' });

    res.json({
      success: true,
      data: {
        latestReading,
        chartData: chartData.reverse(),
        activeAlertsCount,
        statistics: {
          totalReadings,
          dangerPercentage: totalReadings ? Math.round((dangerCount / totalReadings) * 100) : 0,
          warningPercentage: totalReadings ? Math.round((warningCount / totalReadings) * 100) : 0,
          safePercentage: totalReadings ? Math.round((safeCount / totalReadings) * 100) : 0
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboardData };