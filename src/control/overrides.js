/**
 * Manual Overrides
 * ────────────────
 * أوامر التحكم اليدوي من الداشبورد (قفل الغاز / قطع الكهربا / كتم البازر).
 * بتتدمج فوق قرار الـ Decision Engine، فمفيش قرار تلقائي يفتح صمام اتقفل يدوياً.
 * بتتحفظ في MongoDB عشان تفضل بعد أي restart للسيرفر.
 */
const KEY = 'manualOverrides';
const MUTE_MS = 60 * 1000;           // كتم البازر دقيقة

let state = { valveClosed: false, powerCut: false, buzzerMutedUntil: 0 };

// التخزين قابل للاستبدال (للاختبار)
let store = {
  async load() {
    const SystemState = require('../models/systemState');
    const doc = await SystemState.findOne({ key: KEY });
    return doc && doc.value;
  },
  async save(value) {
    const SystemState = require('../models/systemState');
    await SystemState.findOneAndUpdate({ key: KEY }, { value }, { upsert: true }).exec();
  },
};

function setStore(s) { store = s; }

async function load() {
  try {
    const saved = await store.load();
    if (saved && typeof saved === 'object') {
      state = {
        valveClosed: !!saved.valveClosed,
        powerCut: !!saved.powerCut,
        buzzerMutedUntil: 0,           // الكتم مؤقت، مبيترجعش بعد restart
      };
      console.log(`✅ Manual overrides restored (valveClosed=${state.valveClosed}, powerCut=${state.powerCut})`);
    }
  } catch (e) {
    console.error('❌ Overrides load error:', e.message);
  }
}

function persist() {
  Promise.resolve(store.save(state)).catch((e) => console.error('❌ Overrides persist error:', e.message));
}

const get = () => ({ ...state });

function set(patch) {
  state = { ...state, ...patch };
  persist();
  return get();
}

function reset() {
  state = { valveClosed: false, powerCut: false, buzzerMutedUntil: 0 };
  persist();
}

// يدمج الأوامر اليدوية فوق أمر الـ Decision Engine
function applyTo(command, now = Date.now()) {
  const muted = now < state.buzzerMutedUntil;
  return {
    servo:  state.valveClosed ? 'closed' : (command.servo || 'open'),
    relay:  state.powerCut ? true : !!command.relay,
    buzzer: muted ? false : !!command.buzzer,
  };
}

module.exports = { load, get, set, reset, applyTo, setStore, MUTE_MS };
