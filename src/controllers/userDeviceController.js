const mongoose = require('mongoose');
const UserDevice = require('../models/userDevice');

const TYPES = ['mobile', 'tablet', 'computer'];
const MAX_DEVICES = 30;
const ONLINE_MS = 2 * 60 * 1000;                       // الجهاز "Online" لو اتشاف من آخر دقيقتين
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const serialize = (d) => ({
  id: String(d._id),
  user: d.ownerName || '',
  name: d.name,
  type: d.type,
  online: !!d.lastActive && Date.now() - new Date(d.lastActive).getTime() < ONLINE_MS,
  lastActive: d.lastActive,
  notifications: d.notifications,
  control: d.control,
  clientId: d.clientId,
});

const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);
const fail = (res, code, message) => res.status(code).json({ success: false, message });

// GET /api/my-devices
const listDevices = async (req, res) => {
  try {
    const items = await UserDevice.find({ owner: req.user._id }).sort({ lastActive: -1, createdAt: -1 });
    res.json({ success: true, data: items.map(serialize) });
  } catch (e) { fail(res, 500, e.message); }
};

// POST /api/my-devices   { name, type, user }
const createDevice = async (req, res) => {
  try {
    const name = cleanText(req.body.name, 60);
    const type = TYPES.includes(req.body.type) ? req.body.type : 'mobile';
    const ownerName = cleanText(req.body.user, 60) || req.user.username;
    if (!name) return fail(res, 400, 'اسم الجهاز مطلوب');

    if (await UserDevice.countDocuments({ owner: req.user._id }) >= MAX_DEVICES) {
      return fail(res, 400, `الحد الأقصى ${MAX_DEVICES} جهاز`);
    }
    const d = await UserDevice.create({ owner: req.user._id, ownerName, name, type });
    res.status(201).json({ success: true, data: serialize(d) });
  } catch (e) { fail(res, 500, e.message); }
};

// PUT /api/my-devices/:id   { name, type, user }
// PATCH /api/my-devices/:id { notifications?, control? }
const updateDevice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'id غير صالح');
    const set = {};
    if (req.body.name !== undefined) {
      const name = cleanText(req.body.name, 60);
      if (!name) return fail(res, 400, 'اسم الجهاز مطلوب');
      set.name = name;
    }
    if (req.body.type !== undefined) {
      if (!TYPES.includes(req.body.type)) return fail(res, 400, 'نوع الجهاز غير صالح');
      set.type = req.body.type;
    }
    if (req.body.user !== undefined) set.ownerName = cleanText(req.body.user, 60);
    for (const k of ['notifications', 'control']) {
      if (req.body[k] !== undefined) {
        if (typeof req.body[k] !== 'boolean') return fail(res, 400, `${k} لازم true/false`);
        set[k] = req.body[k];
      }
    }
    const d = await UserDevice.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id }, { $set: set }, { new: true }
    );
    if (!d) return fail(res, 404, 'الجهاز مش موجود');
    res.json({ success: true, data: serialize(d) });
  } catch (e) { fail(res, 500, e.message); }
};

// DELETE /api/my-devices/:id
const removeDevice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'id غير صالح');
    const d = await UserDevice.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
    if (!d) return fail(res, 404, 'الجهاز مش موجود');
    res.json({ success: true });
  } catch (e) { fail(res, 500, e.message); }
};

// POST /api/my-devices/heartbeat   { clientId, name, type }
// الموقع بيبعتها كل دقيقة: أول مرة بتسجّل الجهاز الحالي تلقائي (موبايل فتح الموقع وعمل login = بيظهر لوحده)،
// وبعد كده بتحدّث "آخر نشاط" عشان يظهر Online.
const heartbeat = async (req, res) => {
  const clientId = String(req.body.clientId || '');
  if (!CLIENT_ID_RE.test(clientId)) return fail(res, 400, 'clientId غير صالح');

  const run = () => UserDevice.findOneAndUpdate(
    { owner: req.user._id, clientId },
    {
      $set: { lastActive: new Date() },
      $setOnInsert: {
        ownerName: req.user.username,
        name: cleanText(req.body.name, 60) || 'My device',
        type: TYPES.includes(req.body.type) ? req.body.type : 'computer',
      },
    },
    { upsert: true, new: true }
  );

  try {
    let d;
    try { d = await run(); }
    catch (e) { if (e.code === 11000) d = await run(); else throw e; }   // طلبين متزامنين على أول تسجيل
    res.json({ success: true, data: serialize(d) });
  } catch (e) { fail(res, 500, e.message); }
};

module.exports = { listDevices, createDevice, updateDevice, removeDevice, heartbeat };
