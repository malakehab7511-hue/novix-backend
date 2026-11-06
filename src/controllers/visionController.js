const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const Alert = require('../models/alert');
const { setVisionEvent, getVisionStatus, resetLatch } = require('../ai/decisionEngine');

// ─── الصور ────────────────────────────────────────────────────────────────────
const SNAP_DIR = path.join(__dirname, '../../snapshots');
fs.mkdirSync(SNAP_DIR, { recursive: true });

const SNAP_KEEP_MS    = (Number(process.env.SNAPSHOT_KEEP_DAYS) || 7) * 24 * 60 * 60 * 1000;
const SNAP_MAX_FILES  = Number(process.env.SNAPSHOT_MAX_FILES) || 300;

// مسح الصور القديمة: أقدم من SNAPSHOT_KEEP_DAYS (7 أيام) أو أكتر من SNAPSHOT_MAX_FILES (300 صورة)
function cleanupSnapshots() {
  try {
    const files = fs.readdirSync(SNAP_DIR)
      .filter(f => f.endsWith('.jpg'))
      .map(f => {
        const p = path.join(SNAP_DIR, f);
        return { p, t: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.t - a.t);               // الأحدث الأول

    const now = Date.now();
    let removed = 0;
    files.forEach((f, i) => {
      if (i >= SNAP_MAX_FILES || now - f.t > SNAP_KEEP_MS) {
        try { fs.unlinkSync(f.p); removed++; } catch { /* ignore */ }
      }
    });
    if (removed) console.log(`🧹 Removed ${removed} old snapshot(s)`);
  } catch (e) {
    console.error('Snapshot cleanup error:', e.message);
  }
}
cleanupSnapshots();
setInterval(cleanupSnapshots, 60 * 60 * 1000).unref();   // كل ساعة

// ─── منع تكرار التنبيهات ───────────────────────────────────────────────────────
const ALERT_COOLDOWN_MS   = 60 * 1000;         // نار/دخان: تنبيه لكل (كاميرا + مستوى) كل دقيقة
const OFFLINE_COOLDOWN_MS = 10 * 60 * 1000;    // كاميرا واقعة: تنبيه كل 10 دقايق
const lastAlertAt = new Map();

const ALERT_MAP = {
  smoke:       { type: 'smoke', riskLevel: 'warning', msg: 'دخان تم رصده بالكاميرا' },
  fire:        { type: 'fire',  riskLevel: 'danger',  msg: 'نار تم رصدها بالكاميرا' },
  smoke_heavy: { type: 'smoke', riskLevel: 'danger',  msg: 'دخان كثيف بالكاميرا — تم قفل الغاز' },
  fire_large:  { type: 'fire',  riskLevel: 'danger',  msg: 'حريق كبير بالكاميرا — تم قفل الغاز' },
};
const OFFLINE_META = {
  type: 'camera_offline', riskLevel: 'warning',
  msg: 'الكاميرا فصلت — الحماية بالكاميرا متوقفة',
};

const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;

// ─── vision-service يبعت الحالة هنا ───────────────────────────────────────────
const receiveVisionEvent = async (req, res) => {
  try {
    const ev = req.body;
    if (!ev || !ev.camera_id || !ev.level) {
      return res.status(400).json({ success: false, message: 'camera_id و level مطلوبين' });
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(ev.camera_id))) {
      return res.status(400).json({ success: false, message: 'camera_id غير صالح' });
    }

    // 1. حدّث الـ Decision Engine (ده اللي بيقفل الصمام ويحفظ الـ latch)
    setVisionEvent(ev);

    // 2. تنبيه + صورة (مع cooldown)
    const offline = ev.connected === false;
    const meta = offline ? OFFLINE_META : ALERT_MAP[ev.level];
    let alert = null;

    if (meta) {
      const key = `${ev.camera_id}:${offline ? 'offline' : ev.level}`;
      const cooldown = offline ? OFFLINE_COOLDOWN_MS : ALERT_COOLDOWN_MS;
      const now = Date.now();

      if (now - (lastAlertAt.get(key) || 0) > cooldown) {
        lastAlertAt.set(key, now);

        let snapshotUrl = null;
        if (!offline && ev.snapshot) {
          const buf = Buffer.from(ev.snapshot, 'base64');
          if (isJpeg(buf)) {
            const file = `${ev.camera_id}_${now}.jpg`.replace(/[^A-Za-z0-9_.-]/g, '_');
            await fs.promises.writeFile(path.join(SNAP_DIR, file), buf);
            snapshotUrl = `/api/vision/snapshots/${file}`;   // محمي بتسجيل الدخول
          }
        }

        alert = await Alert.create({
          type: meta.type,
          message: `${meta.msg} (${ev.camera_name || ev.camera_id})`,
          riskLevel: meta.riskLevel,
          source: 'camera',
          cameraId: ev.camera_id,
          snapshotUrl,
        });
        global.io.emit('newAlert', alert);
      }
    }

    // 3. للداشبورد real-time
    global.io.emit('visionUpdate', {
      camera_id: ev.camera_id, camera_name: ev.camera_name, level: ev.level,
      connected: !offline,
      close_valve: !!ev.close_valve, fire_area: ev.fire_area, smoke_area: ev.smoke_area,
      stove_active: !!ev.stove_active, ...getVisionStatus(),
    });

    res.status(201).json({ success: true, alert: alert ? alert._id : null });
  } catch (error) {
    console.error('Vision controller error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const visionStatus = (req, res) => res.json({ success: true, data: getVisionStatus() });

// رجّع الصمام لوضعه الطبيعي بعد التأكد إن الخطر انتهى (لازم تسجيل دخول)
const resetValveLatch = (req, res) => {
  resetLatch();
  global.io.emit('visionReset', { at: Date.now(), by: req.user?.username });
  res.json({ success: true, message: 'تم فك قفل الصمام' });
};

// ─── صورة إنذار محفوظة (بعد تسجيل الدخول فقط) ────────────────────────────────
const getSnapshot = (req, res) => {
  const name = path.basename(String(req.params.file));
  if (!/^[A-Za-z0-9_.-]+\.jpg$/.test(name)) {
    return res.status(400).json({ success: false, message: 'اسم الملف غير صالح' });
  }
  const full = path.join(SNAP_DIR, name);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ success: false, message: 'الصورة غير موجودة (ممكن اتمسحت)' });
  }
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
};

// ─── لقطة حية: الباك إند بيجيبها من vision-service بالمفتاح، والمتصفح مبيشوفش المفتاح ─
const visionBase = () => (process.env.VISION_SERVICE_URL || 'http://localhost:8001').replace(/\/$/, '');

const liveFrame = async (req, res) => {
  const id = String(req.params.id);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    return res.status(400).json({ success: false, message: 'camera id غير صالح' });
  }
  try {
    const r = await axios.get(`${visionBase()}/snapshot/${id}`, {
      responseType: 'arraybuffer',
      timeout: 4000,
      headers: { 'x-api-key': process.env.VISION_SERVICE_KEY || '' },
    });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(r.data));
  } catch (e) {
    const code = e.response?.status === 404 ? 404 : 502;
    res.status(code).json({ success: false, message: 'تعذر جلب صورة الكاميرا' });
  }
};

module.exports = { receiveVisionEvent, visionStatus, resetValveLatch, getSnapshot, liveFrame };
