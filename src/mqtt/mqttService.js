/**
 * NOVIX MQTT Service
 * ──────────────────
 * الباك إند بيتصل بـ HiveMQ Cloud (TLS 8883)، والجهاز كمان. الاتنين خارجين بس، فمفيش IP ولا port forwarding.
 *
 * Topics (id = رقم الجهاز، مثلاً novix-001):
 *   novix/<id>/telemetry   جهاز → سحابة   قراءات السنسورات كل ثانيتين
 *   novix/<id>/decision    سحابة → جهاز   القرار الحالي (retained): { servo, buzzer, relay, status, risk }
 *   novix/<id>/cmd         سحابة → جهاز   أمر يدوي: { cmd, id }
 *   novix/<id>/ack         جهاز → سحابة   تأكيد التنفيذ + الحالة الفعلية
 *   novix/<id>/status      جهاز → سحابة   "online" / "offline" (retained + Last Will)
 *
 * المتغيرات (Railway): MQTT_URL  MQTT_USER  MQTT_PASS
 *   MQTT_URL مثلاً: mqtts://xxxx.s1.eu.hivemq.cloud:8883   (لو من غير mqtts:// بنضيفها)
 */
const mqtt = require('mqtt');
const crypto = require('crypto');

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TELEMETRY_STALE_MS = 15 * 1000;

let client = null;
let opts = {};                         // { ingest, getDecision, applyOverrides }
const devices = new Map();             // id -> { online, lastSeen, lastTelemetryAt, ack }
const pending = new Map();             // cmdId -> { resolve, timer }
const busy = new Set();                // أجهزة بتعالج قراءة دلوقتي

const topic = (id, leaf) => `novix/${id}/${leaf}`;

function dev(id) {
  if (!devices.has(id)) devices.set(id, { online: false, lastSeen: 0, lastTelemetryAt: 0, ack: null });
  return devices.get(id);
}

const emit = (event, payload) => { try { global.io && global.io.emit(event, payload); } catch { /* ignore */ } };

function publicState(id) {
  const d = dev(id);
  const fresh = Date.now() - d.lastTelemetryAt < TELEMETRY_STALE_MS;
  return {
    id,
    online: d.online && fresh,
    mqttOnline: d.online,
    lastSeen: d.lastSeen || null,
    ack: d.ack,                         // الحالة الفعلية (من الجهاز نفسه)
  };
}

function normalizeUrl(url) {
  return /^[a-z]+:\/\//i.test(url) ? url : `mqtts://${url}`;
}

// ─── قرار الـ Decision Engine + الأوامر اليدوية → الجهاز ─────────────────────────
function buildDecisionPayload() {
  const latest = opts.getDecision();
  const merged = opts.applyOverrides({
    servo: latest.servo ?? 'open',
    buzzer: latest.buzzer ?? false,
    relay: latest.relay ?? false,
  });
  return {
    servo: merged.servo,
    buzzer: merged.buzzer,
    relay: merged.relay,
    status: latest.label ?? 'SAFE',
    risk: latest.riskScore ?? 0,
    ts: Date.now(),
  };
}

function publishDecision(id) {
  if (!client || !client.connected) return false;
  client.publish(topic(id, 'decision'), JSON.stringify(buildDecisionPayload()), { qos: 1, retain: true });
  return true;
}

// ─── استقبال الرسائل ────────────────────────────────────────────────────────────
async function handleTelemetry(id, data) {
  if (busy.has(id)) return;             // القراءة اللي قبلها لسه بتتعالج
  busy.add(id);
  try {
    const d = dev(id);
    d.online = true;
    d.lastSeen = d.lastTelemetryAt = Date.now();
    const result = await opts.ingest(data);
    if (result.error) {
      console.warn(`⚠️ [${id}] قراءة مرفوضة: ${result.error}`);
      return;
    }
    publishDecision(id);
  } catch (e) {
    console.error(`❌ [${id}] telemetry error:`, e.message);
  } finally {
    busy.delete(id);
  }
}

function handleAck(id, data) {
  const d = dev(id);
  d.online = true;
  d.lastSeen = Date.now();
  d.ack = { ...data, receivedAt: Date.now() };
  const p = data && data.id ? pending.get(data.id) : null;
  if (p) {
    clearTimeout(p.timer);
    pending.delete(data.id);
    p.resolve({ acked: true, ok: data.ok !== false, ack: d.ack });
  }
  emit('deviceAck', { deviceId: id, ack: d.ack });
  emit('deviceState', publicState(id));
}

function handleStatus(id, raw) {
  const text = String(raw).trim();
  let online = text === 'online';
  if (text.startsWith('{')) { try { online = !!JSON.parse(text).online; } catch { /* ignore */ } }
  const d = dev(id);
  d.online = online;
  if (online) {
    d.lastSeen = Date.now();
    publishDecision(id);                // الجهاز رجع: ابعتله القرار الحالي فوراً
  }
  console.log(`📟 [${id}] ${online ? 'ONLINE' : 'OFFLINE'}`);
  emit('deviceState', publicState(id));
}

function onMessage(t, buf) {
  const parts = t.split('/');
  if (parts.length !== 3 || parts[0] !== 'novix') return;
  const [, id, leaf] = parts;
  if (!ID_RE.test(id)) return;
  const text = buf.toString();
  if (leaf === 'status') return handleStatus(id, text);
  let data;
  try { data = JSON.parse(text); } catch { return console.warn(`⚠️ [${id}] ${leaf}: JSON غير صالح`); }
  if (leaf === 'telemetry') return handleTelemetry(id, data);
  if (leaf === 'ack') return handleAck(id, data);
}

// ─── أمر يدوي → الجهاز، وينتظر الـ ack ────────────────────────────────────────
function sendCommand(id, cmd, timeoutMs = 3000) {
  if (!client || !client.connected) return Promise.resolve({ acked: false, reason: 'mqtt_disconnected' });
  const cmdId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(cmdId);
      resolve({ acked: false, reason: 'timeout' });
    }, timeoutMs);
    pending.set(cmdId, { resolve, timer });
    client.publish(topic(id, 'cmd'), JSON.stringify({ cmd, id: cmdId, ts: Date.now() }), { qos: 1 }, (err) => {
      if (err) {
        clearTimeout(timer);
        pending.delete(cmdId);
        resolve({ acked: false, reason: 'publish_failed' });
      }
    });
  });
}

// ─── تشغيل ──────────────────────────────────────────────────────────────────────
function start(options) {
  opts = options;
  const url = process.env.MQTT_URL;
  if (!url) {
    console.warn('⚠️ MQTT_URL مش مضبوط — MQTT متوقف (الجهاز يفضل شغال بالـ HTTP)');
    return null;
  }
  client = mqtt.connect(normalizeUrl(url), {
    username: process.env.MQTT_USER || undefined,
    password: process.env.MQTT_PASS || undefined,
    clientId: `novix-backend-${crypto.randomBytes(4).toString('hex')}`,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
  });

  client.on('connect', () => {
    console.log('✅ MQTT connected');
    client.subscribe(['novix/+/telemetry', 'novix/+/ack', 'novix/+/status'], { qos: 1 }, (err) => {
      if (err) console.error('❌ MQTT subscribe error:', err.message);
    });
  });
  client.on('reconnect', () => console.log('🔄 MQTT reconnecting...'));
  client.on('close', () => console.warn('⚠️ MQTT connection closed'));
  client.on('error', (e) => console.error('❌ MQTT error:', e.message));
  client.on('message', onMessage);
  return client;
}

function stop() {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  return new Promise((resolve) => (client ? client.end(true, {}, resolve) : resolve()));
}

const isEnabled = () => !!client;
const isConnected = () => !!(client && client.connected);
const getDeviceState = (id) => publicState(id);

module.exports = { start, stop, sendCommand, publishDecision, getDeviceState, isEnabled, isConnected, ID_RE };
