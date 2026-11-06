const SensorData = require('../models/sensorData');
const Alert      = require('../models/alert');
const { predictRisk }      = require('../ai/predict');
const { processDecision, getLatestCommand, getLearningStatus, resetBaseline } = require('../ai/decisionEngine');

// ─── استقبال بيانات من الـ ESP32 ─────────────────────────────────────────────
const receiveSensorData = async (req, res) => {
  try {
    // تحقق من القراءات (الـ endpoint ده على الإنترنت، فلازم نرفض أي قيم غلط قبل ما توصل للـ baseline)
    const body = req.body || {};
    const mq2 = Number(body.mq2);
    const mq6 = Number(body.mq6);
    const temperature = Number(body.temperature);
    const humidity = Number(body.humidity);
    const flame = body.flame === true || body.flame === 1 || body.flame === '1' || body.flame === 'true';

    const valid =
      Number.isFinite(mq2) && mq2 >= 0 && mq2 <= 10000 &&
      Number.isFinite(mq6) && mq6 >= 0 && mq6 <= 10000 &&
      Number.isFinite(temperature) && temperature >= -40 && temperature <= 125 &&
      Number.isFinite(humidity) && humidity >= 0 && humidity <= 100;
    if (!valid) {
      return res.status(400).json({ success: false, message: 'قراءات غير صالحة' });
    }

    // 1. شغّل الـ AI
    const aiResult = await predictRisk({ mq2, mq6, flame, temperature, humidity });

    // 2. مرّر النتيجة للـ Decision Engine
    const decision = processDecision(aiResult, { mq2, mq6, flame, temperature, humidity });

    console.log('🤖 AI Raw:', aiResult.label, '→ Stable:', decision.label, '| Trend:', decision.trend, '| Risk:', decision.riskScore);

    // 3. احفظ في MongoDB بالقرار المثبّت
    const sensorData = await SensorData.create({
      mq2,
      mq6,
      flame,
      temperature,
      humidity,
      riskLevel:      decision.riskLevel,
      riskPercentage: decision.riskScore,
      servoStatus:    decision.command.servo,
      buzzerStatus:   decision.command.buzzer,
    });

    // 4. لو في خطر حقيقي — احفظ Alert
    if (decision.riskLevel !== 'safe') {
      let alertType = 'combined';
      if (flame && mq2 <= 400 && mq6 <= 400)  alertType = 'fire';
      else if (!flame && temperature <= 45)    alertType = 'gas_leak';
      else if (temperature > 45 && !flame)     alertType = 'high_temperature';

      const alert = await Alert.create({
        type:         alertType,
        message:      decision.label,
        riskLevel:    decision.riskLevel,
        sensorValues: { mq2, mq6, flame, temperature, humidity },
      });

      global.io.emit('newAlert', alert);
    }

    // 5. بعت للـ Dashboard real-time
    global.io.emit('sensorUpdate', {
      ...sensorData.toObject(),
      trend:      decision.trend,
      riskScore:  decision.riskScore,
      rawLabel:   decision.rawLabel,
    });

    res.status(201).json({
      success: true,
      data:    sensorData,
      decision,
    });

  } catch (error) {
    console.error('Controller error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── الـ ESP32 يسحب آخر أمر ──────────────────────────────────────────────────
const getDeviceCommand = async (req, res) => {
  const latest = getLatestCommand();
  res.json({
    success: true,
    command: {
      servo:  latest.servo  ?? 'open',
      buzzer: latest.buzzer ?? false,
      relay:  latest.relay  ?? false,
      status: latest.label  ?? 'SAFE',
      risk:   latest.riskScore ?? 0,
    },
  });
};

// ─── React Dashboard ──────────────────────────────────────────────────────────
const getLatestReading = async (req, res) => {
  try {
    const latest = await SensorData.findOne().sort({ createdAt: -1 });
    res.json({ success: true, data: latest });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllReadings = async (req, res) => {
  try {
    const readings = await SensorData.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: readings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── حالة الـ baseline (للداشبورد) ───────────────────────────────────────────
const getBaselineStatus = (req, res) => {
  res.json({ success: true, data: getLearningStatus() });
};

// ─── مسح الـ baseline وإعادة التعلم (لما تنقلي الجهاز لمكان تاني) ──────────────
// تحذير: أثناء التعلم (10 دقايق) مفيش قفل غاز على أساس الـ baseline، فلازم تأكيد صريح.
const resetBaselineHandler = (req, res) => {
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({
      success: false,
      message: 'ابعتي { "confirm": true } للتأكيد. هيبدأ تعلم جديد 10 دقايق.',
    });
  }
  resetBaseline();
  res.json({ success: true, message: 'تم مسح الـ baseline. النظام هيتعلم من جديد (10 دقايق).' });
};

module.exports = {
  receiveSensorData,
  getLatestReading,
  getAllReadings,
  getDeviceCommand,
  getBaselineStatus,
  resetBaselineHandler,
};