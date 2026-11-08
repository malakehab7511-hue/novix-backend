/**
 * NOVIX Decision Engine
 * ─────────────────────
 * الفكرة الأساسية:
 * - أول 10 دقائق: وضع Learning — بيحفظ متوسط القراءات الطبيعية
 * - بعد كده: بيحكم على الزيادة فوق الطبيعي بس
 * - الـ AI Model دوره Confirmation بس مش القرار الأساسي
 *
 * [دمج تعديلات الـ AI V3] قواعد ثابتة (قفزة مفاجئة، حدود مطلقة، تأكيد الـ AI V3، لهب فوري)
 * بتشتغل جنب الـ baseline: بترفع الخطورة بس ومبتقللهاش، وبتشتغل حتى أثناء فترة التعلم.
 */

const SystemState = require('../models/systemState');

// ─── Fixed Rules (من تعديلات الـ AI V3) — كلها قابلة للتغيير من متغيرات البيئة ───
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
const SUDDEN_MQ2          = num(process.env.SUDDEN_RISE_MQ2, 300);   // قفزة MQ2 عن متوسط آخر 4 قراءات
const SUDDEN_MQ6          = num(process.env.SUDDEN_RISE_MQ6, 500);   // قفزة MQ6
const ABS_DANGER_MQ2      = num(process.env.ABS_DANGER_MQ2, 1800);   // حد مطلق = خطر (دايماً شغال)
const ABS_DANGER_MQ6      = num(process.env.ABS_DANGER_MQ6, 3200);
const ABS_WARN_MQ2        = num(process.env.ABS_WARN_MQ2, 1000);     // حد مطلق = تحذير (لحد ما الـ baseline يجهز)
const ABS_WARN_MQ6        = num(process.env.ABS_WARN_MQ6, 2000);
const RISING_WARN_MQ2     = 700;                                      // ترند صاعد + قيمة عالية = تحذير (لحد ما الـ baseline يجهز)
const RISING_WARN_MQ6     = 1400;
const IMMEDIATE_HOLD_MS   = num(process.env.IMMEDIATE_HOLD_SECONDS, 30) * 1000;  // تثبيت الخطر الفوري أثناء التعلم (مفيش stabilization وقتها)
let immediateHold = null;   // { until, label, score }

// ─── Learning Phase ───────────────────────────────────────────────────────────
const LEARNING_DURATION_MS = 10 * 60 * 1000;
let startTime = Date.now();
let learningFireUntil = 0;   // أثناء التعلم: لو اتشاف لهب نفضل على FIRE شوية عشان الصمام ما يفتحش ويقفل

const learningBuffer = []; // بيجمع قراءات أول 10 دقائق

let baseline = null; // هيتحسب بعد الـ Learning Phase
/*
baseline = {
  mq2: { mean, std },
  mq6: { mean, std },
  temp: { mean },
}
*/

function isLearning() {
  if (baseline) return false;   // baseline موجود (اتحسب أو اتسترجع من الداتابيز)
  return Date.now() - startTime < LEARNING_DURATION_MS;
}

function computeBaseline(readings) {
  const mean = key => readings.reduce((s, r) => s + r[key], 0) / readings.length;
  const std  = (key, m) => Math.sqrt(
    readings.reduce((s, r) => s + Math.pow(r[key] - m, 2), 0) / readings.length
  );

  const mq2Mean  = mean('mq2');
  const mq6Mean  = mean('mq6');
  const tempMean = mean('temp');

  return {
    mq2:  { mean: mq2Mean,  std: Math.max(std('mq2',  mq2Mean),  20) },
    mq6:  { mean: mq6Mean,  std: Math.max(std('mq6',  mq6Mean),  50) },
    temp: { mean: tempMean },
    computedAt: Date.now(),
  };
}

// ─── Sensor History ───────────────────────────────────────────────────────────
const MAX_HISTORY   = 10;
const sensorHistory = [];

// ─── Decision Stabilization ───────────────────────────────────────────────────
const DECISION_WINDOW = 6;
const MIN_VOTES       = 5;
const decisionHistory = [];

let currentStableDecision = {
  label:     'LEARNING',
  riskLevel: 'safe',
  riskScore: 0,
  servo:     'open',
  buzzer:    false,
  relay:     false,
  trend:     'stable',
  updatedAt: Date.now(),
};

// ─── 1. Sensor History ────────────────────────────────────────────────────────
function updateSensorHistory(raw) {
  const entry = {
    mq2:       Number(raw.mq2),
    mq6:       Number(raw.mq6),
    temp:      Number(raw.temperature ?? raw.temp),
    flame:     raw.flame ? 1 : 0,
    timestamp: Date.now(),
  };
  sensorHistory.push(entry);
  if (sensorHistory.length > MAX_HISTORY) sensorHistory.shift();

  // لو لسه في Learning Phase — احفظ في الـ buffer
  if (isLearning()) {
    if (
        entry.flame === 0 &&
        entry.mq2 > 50 &&
        entry.mq6 > 50
    ) {
        learningBuffer.push(entry);
        if (learningBuffer.length > 600) learningBuffer.shift();
    }

  } else if (!baseline) {
    if (learningBuffer.length >= 60) {
      // انتهى الـ Learning — احسب الـ Baseline واحفظه في الداتابيز
      baseline = computeBaseline(learningBuffer);
      console.log(`✅ Baseline computed from ${learningBuffer.length} readings:`);
      console.log(`   MQ2: ${baseline.mq2.mean.toFixed(0)} ± ${baseline.mq2.std.toFixed(0)}`);
      console.log(`   MQ6: ${baseline.mq6.mean.toFixed(0)} ± ${baseline.mq6.std.toFixed(0)}`);
      console.log(`   Temp: ${baseline.temp.mean.toFixed(1)}`);
      persistBaseline();
    } else {
      // الوقت خلص بس القراءات الصالحة مش كفاية (سنسور فاصل؟): نبدأ نافذة تعلم جديدة بدل ما نفضل عالقين
      console.warn(`⚠️ Learning ended with only ${learningBuffer.length} valid samples — restarting learning window (check the gas sensors)`);
      startTime = Date.now();
    }
  }
}

// ─── 2. Trend Analysis ────────────────────────────────────────────────────────
function analyzeTrend() {
  if (sensorHistory.length < 4) return 'stable';

  const recent     = sensorHistory.slice(-4);
  const firstHalf  = recent.slice(0, 2);
  const secondHalf = recent.slice(2);

  const avg   = arr => arr.reduce((s, r) => s + r.mq2 + r.mq6, 0) / (arr.length * 2);
  const delta = avg(secondHalf) - avg(firstHalf);

  if (delta > 100) return 'rising';
  if (delta < -100) return 'falling';
  return 'stable';
}

// ─── 3. Risk Assessment بناءً على الـ Baseline ────────────────────────────────
/**
 * بيحسب كمية الانحراف عن الطبيعي بالـ Standard Deviations
 * مثلاً: لو MQ6 عادي = 1800 ± 100
 *   و MQ6 دلوقتي = 2500
 *   الانحراف = (2500 - 1800) / 100 = 7 std devs → خطر جداً
 */
function assessBaseline(raw, trend) {
  // لو لسه بيتعلم
  if (isLearning() || !baseline) {
    // أمان: اللهب خطر فوري حتى من غير baseline (وبنثبّته 30 ثانية عشان الصمام ما يرفرفش)
    if (raw.flame) learningFireUntil = Date.now() + 30000;
    if (Date.now() < learningFireUntil) {
      return {
        label:      'FIRE',
        riskLevel:  'danger',
        riskScore:  100,
        immediate:  true,
        reason:     'Flame detected (learning-phase safety fallback)',
      };
    }
    return {
      label:      'LEARNING',
      riskLevel:  'safe',
      riskScore:  0,
      reason:     'System is learning your environment...',
    };
  }

  const mq2 = Number(raw.mq2);
  const mq6 = Number(raw.mq6);
  const flame = raw.flame;

  // حساب الانحراف بالـ Standard Deviations
  const mq2Sigma = (mq2 - baseline.mq2.mean) / baseline.mq2.std;
  const mq6Sigma = (mq6 - baseline.mq6.mean) / baseline.mq6.std;

  // النار → خطر فوري بغض النظر عن أي حاجة
  if (flame) {
    return {
      label:     'FIRE',
      riskLevel: 'danger',
      riskScore: 100,
      immediate: true,
      reason:    'Flame detected',
      mq2Sigma,
      mq6Sigma,
    };
  }

  // حساب الـ Risk Score من الانحراف
  // كل std dev فوق 2 تحسب كخطر
  const mq2Risk = Math.max(0, (mq2Sigma - 1) / 5) * 100; // يبدأ يحسب من sigma=1
  const mq6Risk = Math.max(0, (mq6Sigma - 1) / 5) * 100;

  // Trend Bonus
  const trendBonus = trend === 'rising' ? 15 : trend === 'falling' ? -10 : 0;

  // Risk Score النهائي
  let riskScore = Math.round(
    Math.min(100, Math.max(0,
      mq2Risk * 0.5 +   // MQ2 = دخان (50%)
      mq6Risk * 0.3 +   // MQ6 = غاز (30%)
      trendBonus * 0.2  // Trend (20%)
    ))
  );

  // تحديد الـ Label
  let label, riskLevel;

  if (mq2Sigma > 4 && mq6Sigma > 4) {
    label = 'DANGER'; riskLevel = 'danger';
  } else if (mq2Sigma > 3) {
    label = 'SMOKE'; riskLevel = 'warning';
    if (trend === 'rising') { label = 'GAS_LEAK'; riskLevel = 'danger'; }
  } else if (mq6Sigma > 3) {
    label = 'GAS_LEAK'; riskLevel = trend === 'rising' ? 'danger' : 'warning';
  } else if (mq2Sigma > 1.5 || mq6Sigma > 1.5) {
    label = 'WARNING'; riskLevel = 'warning';
  } else {
    label = 'SAFE'; riskLevel = 'safe'; riskScore = Math.min(riskScore, 10);
  }

  return { label, riskLevel, riskScore, mq2Sigma, mq6Sigma, reason: `MQ2: ${mq2Sigma.toFixed(1)}σ, MQ6: ${mq6Sigma.toFixed(1)}σ` };
}

// ─── 3b. القواعد الثابتة (من تعديلات الـ AI V3) ──────────────────────────────
// بترجّع null لو مفيش حاجة اتحققت. أي نتيجة بتتقارن بنتيجة الـ baseline ويتاخد الأخطر.
// immediate:true = الصمام يتقفل فوراً من غير ما نستنى تصويت الـ stabilization.
function assessFixedRules(raw, aiResult) {
  const mq2   = Number(raw.mq2);
  const mq6   = Number(raw.mq6);
  const flame = raw.flame ? 1 : 0;
  const noBaseline = isLearning() || !baseline;

  // قفزة مفاجئة: القراءة الحالية مقابل متوسط آخر 4 قراءات قبلها
  const prev = sensorHistory.slice(0, -1).slice(-4);
  if (prev.length > 0) {
    const avgOf   = key => prev.reduce((sum, r) => sum + r[key], 0) / prev.length;
    const mq2Rise = mq2 - avgOf('mq2');
    const mq6Rise = mq6 - avgOf('mq6');
    if (mq2Rise >= SUDDEN_MQ2 || mq6Rise >= SUDDEN_MQ6) {
      return {
        label: 'GAS_LEAK', riskLevel: 'danger', riskScore: 100,
        suddenRise: true, immediate: true,
        reason: `Sudden rise detected - MQ2: +${Math.round(mq2Rise)}, MQ6: +${Math.round(mq6Rise)}`,
      };
    }
  }

  // لهب: حريق فوري
  if (flame === 1) {
    return { label: 'FIRE', riskLevel: 'danger', riskScore: 100, immediate: true, reason: 'Flame detected' };
  }

  // حد مطلق للخطر (شغال دايماً)
  if (mq2 > ABS_DANGER_MQ2 || mq6 > ABS_DANGER_MQ6) {
    return {
      label: 'GAS_LEAK', riskLevel: 'danger', riskScore: 100, immediate: true,
      reason: `High gas reading - MQ2: ${mq2}, MQ6: ${mq6}`,
    };
  }

  // تأكيد الـ AI V3 (الـ alarm بيتفعّل بعد 10 قراءات متتالية أو لهب)
  const aiLabel      = aiResult?.label || 'SAFE';
  const aiConfidence = Number(aiResult?.confidence || 0);
  if (aiResult?.alarm && ['FIRE', 'GAS_LEAK', 'DANGER'].includes(aiLabel)) {
    return {
      label: aiLabel === 'DANGER' ? 'GAS_LEAK' : aiLabel,
      riskLevel: 'danger', riskScore: 90, immediate: true,
      reason: `AI V3 confirmed ${aiResult.v3Label || aiLabel} (${aiConfidence}% hazard probability)`,
    };
  }
  if (aiResult?.alarm && aiLabel === 'SMOKE') {
    return {
      label: 'WARNING', riskLevel: 'warning', riskScore: 50,
      reason: `AI V3 confirmed ${aiResult.v3Label || aiLabel} (${aiConfidence}% hazard probability)`,
    };
  }

  // قواعد التحذير المطلقة: بس لحد ما يبقى فيه baseline (بعدها الـ baseline أدق منها)
  if (noBaseline) {
    if (mq2 > ABS_WARN_MQ2 || mq6 > ABS_WARN_MQ6) {
      return {
        label: 'SMOKE', riskLevel: 'warning', riskScore: 60,
        reason: `Elevated gas/smoke reading - MQ2: ${mq2}, MQ6: ${mq6}`,
      };
    }
    if (analyzeTrend() === 'rising' && (mq2 > RISING_WARN_MQ2 || mq6 > RISING_WARN_MQ6)) {
      return { label: 'WARNING', riskLevel: 'warning', riskScore: 40, reason: 'Sensor readings are rising' };
    }
  }
  return null;
}

// ─── 3c. التقييم النهائي = الأخطر بين الـ baseline والقواعد الثابتة ─────────────
const ASSESS_RANK = { LEARNING: 0, SAFE: 0, WARNING: 1, SMOKE: 1, GAS_LEAK: 2, DANGER: 2, FIRE: 3 };
function assessRisk(raw, trend, aiResult) {
  const base  = assessBaseline(raw, trend);
  const fixed = assessFixedRules(raw, aiResult);
  if (!fixed) return base;
  const rank = a => (ASSESS_RANK[a.label] ?? 0);
  if (rank(fixed) !== rank(base)) return rank(fixed) > rank(base) ? fixed : base;
  if (!!fixed.immediate !== !!base.immediate) return fixed.immediate ? fixed : base;
  return (fixed.riskScore ?? 0) > (base.riskScore ?? 0) ? fixed : base;
}

// ─── 4. Stabilization ────────────────────────────────────────────────────────
function recordDecision(label) {
  decisionHistory.push(label);
  if (decisionHistory.length > DECISION_WINDOW) decisionHistory.shift();
}

function getStableLabel(newLabel) {
  // في وضع التعلم مش بنطبق stabilization
  if (newLabel === 'LEARNING') return 'LEARNING';

  recordDecision(newLabel);

  if (decisionHistory.length >= DECISION_WINDOW) {
    const counts = {};
    for (const l of decisionHistory) counts[l] = (counts[l] || 0) + 1;
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (winner[1] >= MIN_VOTES) return winner[0];
  }

  return currentStableDecision.label === 'LEARNING' ? newLabel : currentStableDecision.label;
}

// ─── 5. Command ───────────────────────────────────────────────────────────────
function buildCommand(stableLabel, riskScore, flame) {
  const isDanger  = ['DANGER', 'GAS_LEAK', 'FIRE'].includes(stableLabel);
  const isWarning = ['WARNING', 'SMOKE'].includes(stableLabel);

  return {
    servo:
(stableLabel === "GAS_LEAK" || stableLabel === "DANGER" || stableLabel === "FIRE")
? "closed"
: "open",
    buzzer: isDanger ,
    relay:  Boolean(flame) || stableLabel === 'FIRE',
    status: stableLabel,
    risk:   riskScore,
  };
}


// ─── Vision (Camera) Integration ─────────────────────────────────────────────
// الكاميرا مصدر إنذار تاني. الـ vision-service بيبعت الحالة كل كام ثانية.
const VISION_STALE_MS = 10 * 1000;               // لو الكاميرا سكتت 10 ث نتجاهل آخر حالة
const VISION_LATCH    = process.env.VISION_LATCH !== 'false'; // الصمام يفضل مقفول لحد Reset يدوي
const VISION_RANK = { clear: 0, smoke: 1, fire: 2, smoke_heavy: 3, fire_large: 4 };
const visionState = new Map();                    // cameraId -> { level, updatedAt, ... }
let valveLatched = false;
let latchInfo = null;

function setVisionEvent(ev) {
  // الكاميرا واقعة: نسجّل إنها offline من غير ما نغيّر الصمام أو نطلق إنذار كاذب
  if (ev.connected === false) {
    visionState.set(ev.camera_id, {
      cameraId:   ev.camera_id,
      cameraName: ev.camera_name || ev.camera_id,
      level:      'clear',
      reason:     ev.reason || 'camera offline',
      confidence: 0,
      closeValve: false,
      connected:  false,
      updatedAt:  Date.now(),
    });
    return;
  }

  const level = VISION_RANK[ev.level] !== undefined ? ev.level : 'clear';
  visionState.set(ev.camera_id, {
    cameraId:   ev.camera_id,
    cameraName: ev.camera_name || ev.camera_id,
    level,
    reason:     ev.reason || '',
    confidence: ev.confidence || 0,
    closeValve: level === 'fire_large' || level === 'smoke_heavy',
    connected:  true,
    updatedAt:  Date.now(),
  });

  // خطر حرج: اقفل الصمام فوراً من غير ما نستنى قراءة الـ ESP32
  if (level === 'fire_large' || level === 'smoke_heavy') {
    if (VISION_LATCH && !valveLatched) {
      valveLatched = true;
      latchInfo = { cameraId: ev.camera_id, cameraName: ev.camera_name || ev.camera_id, level, at: Date.now() };
      persistLatch();                       // نحفظه في الداتابيز عشان يفضل بعد أي restart
    }
    const label = level === 'fire_large' ? 'FIRE' : 'DANGER';
    currentStableDecision = {
      ...currentStableDecision,
      label, riskLevel: 'danger',
      riskScore: level === 'fire_large' ? 100 : 90,
      servo: 'closed', buzzer: true, status: label, updatedAt: Date.now(),
    };
  }
}

function getActiveVision() {
  let worst = null;
  const now = Date.now();
  for (const v of visionState.values()) {
    if (now - v.updatedAt > VISION_STALE_MS) continue;
    if (!worst || VISION_RANK[v.level] > VISION_RANK[worst.level]) worst = v;
  }
  return worst && worst.level !== 'clear' ? worst : null;
}

const SEVERITY = { LEARNING: 0, SAFE: 0, WARNING: 1, SMOKE: 1, GAS_LEAK: 2, DANGER: 2, FIRE: 3 };
function mergeWithVision(label, vision, raw) {
  if (!vision) return { label, bypass: false, score: 0 };
  const sensorFlame = !!raw.flame;
  switch (vision.level) {
    case 'fire_large':  return { label: 'FIRE',   bypass: true,  score: 100 };
    case 'smoke_heavy': return { label: 'DANGER', bypass: true,  score: 90  };
    case 'fire':
      // نار صغيرة: لو السنسور أكد → حريق، غير كده تحذير
      return sensorFlame
        ? { label: 'FIRE', bypass: true, score: 85 }
        : { label: (SEVERITY[label] ?? 0) >= 1 ? label : 'WARNING', bypass: false, score: 60 };
    case 'smoke':
      return { label: (SEVERITY[label] ?? 0) >= 1 ? label : 'SMOKE', bypass: false, score: 40 };
    default:            return { label, bypass: false, score: 0 };
  }
}

// ─── Baseline Persistence (MongoDB) ───────────────────────────────────────────
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isValidBaseline = (b) =>
  !!b && b.mq2 && b.mq6 && b.temp &&
  isNum(b.mq2.mean) && isNum(b.mq2.std) && b.mq2.std > 0 &&
  isNum(b.mq6.mean) && isNum(b.mq6.std) && b.mq6.std > 0 &&
  isNum(b.temp.mean) && isNum(b.computedAt);

function persistBaseline() {
  SystemState.findOneAndUpdate(
    { key: 'baseline' },
    { value: baseline },
    { upsert: true }
  ).exec().catch(e => console.error('❌ Baseline persist error:', e.message));
}

// بتتنادى بعد الاتصال بالداتابيز: لو فيه baseline محفوظ وحديث نستخدمه ونتخطى فترة التعلم
async function loadBaseline() {
  try {
    if (process.env.BASELINE_RESET === 'true') {
      await SystemState.findOneAndUpdate({ key: 'baseline' }, { value: null }, { upsert: true });
      console.log('🔄 BASELINE_RESET=true — الـ baseline القديم اتمسح والنظام هيتعلم من جديد (شيلي المتغير بعد التشغيل)');
      return;
    }
    const doc = await SystemState.findOne({ key: 'baseline' });
    const saved = doc && doc.value;
    if (!isValidBaseline(saved)) return;

    const maxAgeMs = (Number(process.env.BASELINE_MAX_AGE_DAYS) || 30) * 24 * 60 * 60 * 1000;
    if (Date.now() - saved.computedAt > maxAgeMs) {
      console.log('⚠️ الـ baseline المحفوظ قديم — النظام هيتعلم من جديد');
      return;
    }
    baseline = saved;
    console.log(`✅ Baseline restored from DB (MQ2 ${saved.mq2.mean.toFixed(0)} ± ${saved.mq2.std.toFixed(0)}, MQ6 ${saved.mq6.mean.toFixed(0)} ± ${saved.mq6.std.toFixed(0)}) — مفيش فترة تعلم`);
  } catch (e) {
    console.error('❌ Baseline load error:', e.message);
  }
}

// مسح الـ baseline وإعادة التعلم (لما الجهاز يتنقل لمكان تاني). الصمام يفضل مقفول لو الـ latch شغال.
function resetBaseline() {
  baseline = null;
  learningBuffer.length = 0;
  learningFireUntil = 0;
  immediateHold = null;
  startTime = Date.now();
  decisionHistory.length = 0;
  currentStableDecision = {
    ...currentStableDecision,
    label: 'LEARNING', riskLevel: 'safe', riskScore: 0,
    servo: valveLatched ? 'closed' : 'open', buzzer: valveLatched, relay: false,
    status: 'LEARNING', updatedAt: Date.now(),
  };
  SystemState.findOneAndUpdate({ key: 'baseline' }, { value: null }, { upsert: true })
    .exec().catch(e => console.error('❌ Baseline reset persist error:', e.message));
  console.log('🔄 Baseline reset — learning restarted');
}

// الاسترجاع الكامل عند التشغيل (server.js)
async function loadPersistedState() {
  await loadLatch();
  await loadBaseline();
}

function resetLatch() {
  valveLatched = false;
  latchInfo = null;
  visionState.clear();
  persistLatch();
}

// ─── Latch Persistence (MongoDB) ──────────────────────────────────────────────
function persistLatch() {
  SystemState.findOneAndUpdate(
    { key: 'valveLatch' },
    { value: { latched: valveLatched, info: latchInfo } },
    { upsert: true }
  ).exec().catch(e => console.error('❌ Latch persist error:', e.message));
}

// بتتنادى مرة واحدة بعد الاتصال بالداتابيز (server.js)
async function loadLatch() {
  if (!VISION_LATCH) return;
  try {
    const doc = await SystemState.findOne({ key: 'valveLatch' });
    if (doc && doc.value && doc.value.latched) {
      valveLatched = true;
      latchInfo = doc.value.info || null;
      const label = latchInfo && latchInfo.level === 'fire_large' ? 'FIRE' : 'DANGER';
      currentStableDecision = {
        ...currentStableDecision,
        label, riskLevel: 'danger', riskScore: label === 'FIRE' ? 100 : 90,
        servo: 'closed', buzzer: true, status: label, updatedAt: Date.now(),
      };
      console.log('🔒 Valve latch restored from DB — الصمام فضل مقفول لحد Reset يدوي');
    }
  } catch (e) {
    console.error('❌ Latch load error:', e.message);
  }
}

function getVisionStatus() {
  return {
    valveLatched, latchInfo,
    cameras: [...visionState.values()].map(v => ({
      ...v, stale: Date.now() - v.updatedAt > VISION_STALE_MS,
    })),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function processDecision(aiResult, raw) {
  // 1. حدّث الـ History والـ Baseline
  updateSensorHistory(raw);

  // 2. Trend
  const trend = analyzeTrend();

  // 3. تقييم الخطر: الأخطر بين الـ baseline والقواعد الثابتة (قفزة مفاجئة / حدود مطلقة / تأكيد الـ AI V3 / لهب)
  const assessment = assessRisk(raw, trend, aiResult);
  const finalLabel = assessment.label;

  // 4. دمج الكاميرا
  const vision = getActiveVision();
  const merged = mergeWithVision(finalLabel, vision, raw);

  // 5. Stabilization: الخطر الفوري (لهب / قفزة / حد مطلق / AI مؤكد / كاميرا) بيتنفذ على طول،
  //    وبنسجّله في الـ history عشان الصمام ما يفتحش ويقفل مع أول قراءة سليمة بعده.
  const immediate  = merged.bypass || assessment.immediate === true;
  let stableLabel;
  if (immediate) { stableLabel = merged.label; recordDecision(stableLabel); }
  else           { stableLabel = getStableLabel(merged.label); }
  let riskScore = Math.max(assessment.riskScore, merged.score);

  // أثناء التعلم مفيش stabilization، فبنثبّت الخطر الفوري كام ثانية عشان الصمام ما يفتحش ويقفل مع كل قراءة
  if (immediate && ['FIRE', 'GAS_LEAK', 'DANGER'].includes(stableLabel)) {
    immediateHold = { until: Date.now() + IMMEDIATE_HOLD_MS, label: stableLabel, score: riskScore };
  } else if (stableLabel === 'LEARNING' && immediateHold && Date.now() < immediateHold.until) {
    stableLabel = immediateHold.label;
    riskScore   = Math.max(riskScore, immediateHold.score);
  }

  // 6. riskLevel
  const riskLevel = {
    LEARNING: 'safe',
    SAFE:     'safe',
    WARNING:  'warning',
    SMOKE:    'warning',
    GAS_LEAK: 'danger',
    FIRE:     'danger',
    DANGER:   'danger',
  }[stableLabel] ?? 'warning';

  // 7. Command
  const command = buildCommand(stableLabel, riskScore, raw.flame);
  if (valveLatched) {            // الصمام يفضل مقفول لحد Reset يدوي
    command.servo  = 'closed';
    command.buzzer = true;
  }

  currentStableDecision = {
    label: stableLabel, riskLevel,
    riskScore,
    trend, ...command, updatedAt: Date.now(),
  };

  const learningStatus = isLearning()
    ? `LEARNING (${Math.round((LEARNING_DURATION_MS - (Date.now() - startTime)) / 1000)}s left)`
    : `Baseline ready`;

  console.log(`[${learningStatus}] ${assessment.reason ?? '-'} | AI: ${aiResult?.label ?? 'N/A'} (${aiResult?.confidence ?? 0}%) | Label: ${finalLabel} → Stable: ${stableLabel} | Risk: ${riskScore}%${vision ? ` | 📷 ${vision.cameraName}: ${vision.level}` : ''}`);

  return {
    command,
    label:      stableLabel,
    rawLabel:   aiResult?.label ?? 'SAFE',
    riskLevel,
    riskScore,
    trend,
    vision:     vision ? { camera: vision.cameraName, level: vision.level } : null,
    valveLatched,
    isLearning: isLearning(),
    baseline:   baseline ? { mq2: baseline.mq2.mean, mq6: baseline.mq6.mean } : null,
    confidence: aiResult?.confidence ?? 0,
    isAnomaly:  aiResult?.isAnomaly  ?? false,
    forecast:   aiResult?.forecast   ?? null,
  };
}

// ─── Getters ──────────────────────────────────────────────────────────────────
function getLatestCommand()  { return currentStableDecision; }
function getSensorHistory()  { return [...sensorHistory]; }
function getDecisionHistory(){ return [...decisionHistory]; }
function getBaseline()       { return baseline; }
function getLearningStatus() {
  if (isLearning()) {
    const remaining = Math.round((LEARNING_DURATION_MS - (Date.now() - startTime)) / 1000);
    return { isLearning: true, remainingSeconds: remaining, samplesCollected: learningBuffer.length };
  }
  return { isLearning: false, baseline };
}

module.exports = {
  setVisionEvent,
  getVisionStatus,
  resetLatch,
  loadLatch,
  loadBaseline,
  loadPersistedState,
  resetBaseline,
  processDecision,
  getLatestCommand,
  getSensorHistory,
  getDecisionHistory,
  getBaseline,
  getLearningStatus,
};