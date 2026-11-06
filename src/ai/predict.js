const axios = require('axios');

// عنوان الـ AI service. على الإنتاج لازم يتحدد بـ AI_SERVICE_URL، ولو فاضي بنستخدم الـ fallback المحلي.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000');
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 2000;

const predictRisk = async (sensorData) => {
  if (!AI_SERVICE_URL) return fallbackPredict(sensorData);   // مفيش AI service: نستخدم القواعد الثابتة

  try {
    const { mq2, mq6, temperature, humidity, flame } = sensorData;

    const payload = {
      mq2,
      mq6,
      temp: temperature,
      humidity,
      flame: flame ? 1 : 0
    };

    // استدعاء الـ Random Forest
    const [classifyRes, anomalyRes, forecastRes] = await Promise.allSettled([
      axios.post(`${AI_SERVICE_URL}/predict/classify`, payload, { timeout: AI_TIMEOUT_MS }),
      axios.post(`${AI_SERVICE_URL}/predict/anomaly`, payload, { timeout: AI_TIMEOUT_MS }),
      axios.post(`${AI_SERVICE_URL}/predict/forecast`, payload, { timeout: AI_TIMEOUT_MS })
    ]);

    // Random Forest النتيجة
    const classify = classifyRes.status === 'fulfilled'
      ? classifyRes.value.data
      : { label: 'UNKNOWN', riskLevel: 'warning', confidence: 0 };

    // Isolation Forest النتيجة
    const anomaly = anomalyRes.status === 'fulfilled'
      ? anomalyRes.value.data
      : { isAnomaly: false, riskScore: 0 };

    // LSTM النتيجة
    const forecast = forecastRes.status === 'fulfilled'
      ? forecastRes.value.data
      : { ready: false };

    // حساب الـ risk percentage
    let riskPercentage = anomaly.riskScore || 0;
    if (classify.riskLevel === 'danger') riskPercentage = Math.max(riskPercentage, 80);
    if (classify.riskLevel === 'warning') riskPercentage = Math.max(riskPercentage, 50);
    if (classify.riskLevel === 'safe') riskPercentage = Math.min(riskPercentage, 30);

    return {
      riskLevel: classify.riskLevel,
      riskPercentage: Math.round(riskPercentage),
      label: classify.label,
      confidence: classify.confidence,
      isAnomaly: anomaly.isAnomaly,
      forecast: forecast.ready ? forecast.forecast : null,
      reasons: [classify.label]
    };

  } catch (error) {
    console.error('AI Service error:', error.message);
    // Fallback للـ logic القديم
    return fallbackPredict(sensorData);
  }
};

// Fallback لو الـ AI Service وقع
const fallbackPredict = (sensorData) => {
  const { mq2, mq6, flame, temperature } = sensorData;
  let riskScore = 0;
  let reasons = [];

  if (mq2 > 700) { riskScore += 35; reasons.push('Gas (MQ-2) level is very high'); }
  else if (mq2 > 400) { riskScore += 20; reasons.push('Gas (MQ-2) level is elevated'); }
  if (mq6 > 700) { riskScore += 35; reasons.push('LPG Gas (MQ-6) level is very high'); }
  else if (mq6 > 400) { riskScore += 20; reasons.push('LPG Gas (MQ-6) level is elevated'); }
  if (flame) { riskScore += 40; reasons.push('Flame detected!'); }
  if (temperature > 60) { riskScore += 20; reasons.push('Temperature is critically high'); }
  else if (temperature > 45) { riskScore += 10; reasons.push('Temperature is elevated'); }

  let riskLevel = riskScore >= 60 ? 'danger' : riskScore >= 30 ? 'warning' : 'safe';

  return {
    riskLevel,
    riskPercentage: Math.min(riskScore, 100),
    label: riskLevel.toUpperCase(),
    confidence: 100,
    isAnomaly: riskScore > 30,
    forecast: null,
    reasons
  };
};

module.exports = { predictRisk };