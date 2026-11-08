// عميل الـ AI service (النسخة V3: FastAPI + LightGBM hybrid).
// بيكلم POST /predict ويترجم تسميات V3 للتسميات اللي decisionEngine فاهمها.
// لو الـ AI service مش متاح أو مش متحدد، بيرجّع نتيجة محايدة (من غير إنذار كاذب)
// وقواعد decisionEngine (baseline + القواعد الثابتة + اللهب) بتفضل شغالة.
// محتاج Node 18+ (global fetch).

// الإنتاج: لازم AI_SERVICE_URL يتحدد (ولو فاضي بنتخطى الـ AI). محلياً: 127.0.0.1:8000
const AI_URL = process.env.AI_SERVICE_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8000');
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 2000;

// V3 label -> decisionEngine label
const LABEL_MAP = {
  NORMAL:              'SAFE',
  BENIGN_INTERFERENCE: 'SAFE',
  SMOKE_LIKE:          'SMOKE',
  GAS_LEAK:            'GAS_LEAK',
  FIRE:                'FIRE',
  // خطر مؤكد من الـ AI بس النوع مش مؤكد: نتصرف بأمان (الصمام يقفل + بازر)
  HAZARD_UNKNOWN:      'DANGER',
};

// قواعد ثابتة بسيطة بتتحسب لو الـ AI مش متاح (للعرض والتشخيص بس — مش بتتحكم في الصمام)
const fallbackPredict = (sensorData) => {
  const { mq2, mq6, flame, temperature } = sensorData;
  let riskScore = 0;
  const reasons = [];

  if (mq2 > 700) { riskScore += 35; reasons.push('Gas (MQ-2) level is very high'); }
  else if (mq2 > 400) { riskScore += 20; reasons.push('Gas (MQ-2) level is elevated'); }
  if (mq6 > 700) { riskScore += 35; reasons.push('LPG Gas (MQ-6) level is very high'); }
  else if (mq6 > 400) { riskScore += 20; reasons.push('LPG Gas (MQ-6) level is elevated'); }
  if (flame) { riskScore += 40; reasons.push('Flame detected!'); }
  if (temperature > 60) { riskScore += 20; reasons.push('Temperature is critically high'); }
  else if (temperature > 45) { riskScore += 10; reasons.push('Temperature is elevated'); }

  const riskLevel = riskScore >= 60 ? 'danger' : riskScore >= 30 ? 'warning' : 'safe';
  return { riskLevel, riskPercentage: Math.min(riskScore, 100), reasons };
};

const neutral = (sensorData, status, extra = {}) => ({
  label: 'SAFE', confidence: 0, isAnomaly: false, forecast: null,
  alarm: false, status, source: 'fallback',
  ...fallbackPredict(sensorData),
  ...extra,
});

const predictRisk = async (sensorData) => {
  if (!AI_URL) return neutral(sensorData, 'disabled');   // مفيش AI service متحدد

  const { mq2, mq6, temperature, humidity, flame, deviceId } = sensorData;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        device_id: String(deviceId || 'default'),
        mq2: Number(mq2), mq6: Number(mq6),
        temp: Number(temperature), humidity: Number(humidity),
        flame: Number(flame) ? 1 : 0,
      }),
    });
    if (!res.ok) throw new Error(`AI service HTTP ${res.status}`);
    const ai = await res.json();

    // calibrating / warming_up / error => لسه مفيش حكم من الـ AI. نتيجة محايدة، مفيش إنذار كاذب.
    // (قواعد decisionEngine واللهب بيحموا في الوقت ده.)
    console.log('[AI]', ai.status, ai.label, ai.calibration_progress || ai.reason || '');
    if (ai.status !== 'ready') {
      return neutral(sensorData, ai.status, {
        source: 'novix-v3', reason: ai.reason, calibration: ai.calibration_progress,
      });
    }

    const label = LABEL_MAP[ai.label] || 'SAFE';
    const confidence = Math.round((ai.hazard_probability ?? 0) * 100);
    return {
      label,
      v3Label: ai.label,
      confidence,
      isAnomaly: label !== 'SAFE',
      forecast: null,
      alarm: !!ai.alarm,
      safetyOverride: !!ai.safety_override,
      status: ai.status,
      reason: ai.reason,
      source: 'novix-v3',
      // حقول متوافقة مع النسخة القديمة
      riskLevel: label === 'SAFE' ? 'safe' : (['FIRE', 'GAS_LEAK', 'DANGER'].includes(label) ? 'danger' : 'warning'),
      riskPercentage: confidence,
      reasons: ai.reason ? [ai.reason] : [],
    };
  } catch (err) {
    console.error('AI service unavailable (decisionEngine rules still active):', err.message);
    return neutral(sensorData, 'fallback');
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { predictRisk };
