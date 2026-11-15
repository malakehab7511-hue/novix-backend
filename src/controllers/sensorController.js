const SensorData = require('../models/sensorData');
const Alert      = require('../models/alert');
const { predictRisk }      = require('../ai/predict');
const { processDecision, getLatestCommand, getLearningStatus, resetBaseline } = require('../ai/decisionEngine');
const overrides = require('../control/overrides');

// ─── التنبيهات: من غير تكرار ─────────────────────────────────────────────────
// الخطر المستمر بيبعت قراءة كل ثانيتين. بدل إنذار جديد كل مرة (كان بيوصل لـ 99+ في دقائق):
//  • لو فيه إنذار مفتوح بنفس المستوى اتشاف من أقل من ALERT_COOLDOWN_MS → نزوّد عداده بس (من غير إشعار جديد)
//  • لو الوضع رجع آمن لمدة ALERT_AUTO_RESOLVE_MS → إنذارات السنسورات المفتوحة بتتقفل لوحدها
const ALERT_COOLDOWN_MS     = Number(process.env.ALERT_COOLDOWN_MS)     || 5 * 60 * 1000;
const ALERT_AUTO_RESOLVE_MS = Number(process.env.ALERT_AUTO_RESOLVE_MS) || 2 * 60 * 1000;
let safeSince = 0;

async function handleSensorAlert(decision, values) {
  const { mq2, mq6, flame, temperature } = values;

  if (decision.riskLevel === 'safe') {
    const now = Date.now();
    if (!safeSince) { safeSince = now; return; }
    if (now - safeSince >= ALERT_AUTO_RESOLVE_MS) {
      safeSince = now;                                   // نكرر الفحص كل ALERT_AUTO_RESOLVE_MS بس
      const r = await Alert.updateMany(
        { source: 'sensor', isResolved: false },
        { isResolved: true, resolvedAt: new Date() }
      );
      if (r.modifiedCount) global.io.emit('alertsResolvedAll', { count: r.modifiedCount, auto: true });
    }
    return;
  }

  safeSince = 0;
  let alertType = 'combined';
  if (flame && mq2 <= 400 && mq6 <= 400)  alertType = 'fire';
  else if (!flame && temperature <= 45)    alertType = 'gas_leak';
  else if (temperature > 45 && !flame)     alertType = 'high_temperature';

  const now = new Date();
  const cutoff = new Date(now.getTime() - ALERT_COOLDOWN_MS);

  // تحديث ذري: لو لاقى إنذار مفتوح بنفس المستوى يزوّده، لو لأ يرجّع null
  const existing = await Alert.findOneAndUpdate(
    {
      source: 'sensor',
      riskLevel: decision.riskLevel,
      isResolved: false,
      $or: [{ lastSeenAt: { $gte: cutoff } }, { lastSeenAt: null, createdAt: { $gte: cutoff } }],
    },
    {
      $inc: { count: 1 },
      $set: { lastSeenAt: now, type: alertType, message: decision.label, sensorValues: values },
    },
    { new: true }
  );
  if (existing) return;

  const alert = await Alert.create({
    type:         alertType,
    message:      decision.label,
    riskLevel:    decision.riskLevel,
    sensorValues: values,
    lastSeenAt:   now,
  });
  global.io.emit('newAlert', alert);
}

// ─── معالجة قراءة واحدة (مشتركة بين HTTP و MQTT) ──────────────────────────────
// بترجّع { error } لو القراءة غلط، أو { sensorData, decision }
const ingestReading = async (body) => {
  // تحقق من القراءات (الـ endpoint ده على الإنترنت، فلازم نرفض أي قيم غلط قبل ما توصل للـ baseline)
  const b = body || {};
  const mq2 = Number(b.mq2);
  const mq6 = Number(b.mq6);
  const temperature = Number(b.temperature);
  const humidity = Number(b.humidity);
  const flame = b.flame === true || b.flame === 1 || b.flame === '1' || b.flame === 'true';

  const valid =
    Number.isFinite(mq2) && mq2 >= 0 && mq2 <= 10000 &&
    Number.isFinite(mq6) && mq6 >= 0 && mq6 <= 10000 &&
    Number.isFinite(temperature) && temperature >= -40 && temperature <= 125 &&
    Number.isFinite(humidity) && humidity >= 0 && humidity <= 100;
  if (!valid) return { error: 'قراءات غير صالحة' };

  // 1. شغّل الـ AI
  // الـ deviceId بيحدد جلسة الـ AI V3 (معايرة + تاريخ القراءات لكل جهاز). الافتراضي 'default' عشان MQTT و HTTP يشاركوا نفس الجلسة.
  const deviceId = String(b.deviceId || b.device_id || 'default');
  const aiResult = await predictRisk({ mq2, mq6, flame, temperature, humidity, deviceId });

  // 2. مرّر النتيجة للـ Decision Engine
  const decision = processDecision(aiResult, { mq2, mq6, flame, temperature, humidity });

  console.log('🤖 AI Raw:', aiResult.label, '→ Stable:', decision.label, '| Trend:', decision.trend, '| Risk:', decision.riskScore);

  // 3. احفظ في MongoDB بالقرار المثبّت (بعد دمج الأوامر اليدوية)
  const finalCmd = overrides.applyTo(decision.command);
  const sensorData = await SensorData.create({
    mq2,
    mq6,
    flame,
    temperature,
    humidity,
    riskLevel:      decision.riskLevel,
    riskPercentage: decision.riskScore,
    servoStatus:    finalCmd.servo,
    buzzerStatus:   finalCmd.buzzer,
    relayStatus:    finalCmd.relay,
  });

  // 4. التنبيهات: إنذار واحد لكل حادثة (مش واحد لكل قراءة)
  try {
    await handleSensorAlert(decision, { mq2, mq6, flame, temperature, humidity });
  } catch (e) {
    console.error('⚠️ alert error:', e.message);   // مشكلة في التنبيه ما توقفش القراءة
  }

  // 5. بعت للـ Dashboard real-time
  global.io.emit('sensorUpdate', {
    ...sensorData.toObject(),
    trend:      decision.trend,
    riskScore:  decision.riskScore,
    rawLabel:   decision.rawLabel,
  });

  return { sensorData, decision };
};

// ─── استقبال بيانات من الـ ESP32 (HTTP) ──────────────────────────────────────
const receiveSensorData = async (req, res) => {
  try {
    const result = await ingestReading(req.body);
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    res.status(201).json({
      success: true,
      data:    result.sensorData,
      decision: result.decision,
    });
  } catch (error) {
    console.error('Controller error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── الـ ESP32 يسحب آخر أمر ──────────────────────────────────────────────────
const getDeviceCommand = async (req, res) => {
  const latest = getLatestCommand();
  const merged = overrides.applyTo({
    servo:  latest.servo  ?? 'open',
    buzzer: latest.buzzer ?? false,
    relay:  latest.relay  ?? false,
  });
  res.json({
    success: true,
    command: {
      servo:  merged.servo,
      buzzer: merged.buzzer,
      relay:  merged.relay,
      status: latest.label ?? 'SAFE',
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
  ingestReading,
  handleSensorAlert,
  receiveSensorData,
  getLatestReading,
  getAllReadings,
  getDeviceCommand,
  getBaselineStatus,
  resetBaselineHandler,
};
