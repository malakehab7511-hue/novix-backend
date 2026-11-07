/**
 * Command Policy — قواعد الأمان للتحكم عن بعد
 * ─────────────────────────────────────────────
 *  - valve_close, power_cut, alarm_off : مسموحين دايماً
 *  - valve_open, power_on              : ممنوعين أثناء إنذار نشط
 *      (خطر DANGER/GAS_LEAK/FIRE، أو قفل الصمام بالكاميرا لسه شغال)
 */
const overrides = require('./overrides');

const COMMANDS = ['valve_close', 'valve_open', 'power_cut', 'power_on', 'alarm_off'];
const RESTRICTED = new Set(['valve_open', 'power_on']);

// مصدر حالة الإنذار — بيتحدد من الـ decision engine، وقابل للاستبدال للاختبار
let alarmProvider = () => {
  const { getLatestCommand, getVisionStatus } = require('../ai/decisionEngine');
  const latest = getLatestCommand();
  const vision = getVisionStatus();
  return {
    active: latest.riskLevel === 'danger' || !!vision.valveLatched,
    label: latest.label,
    valveLatched: !!vision.valveLatched,
  };
};
function setAlarmProvider(fn) { alarmProvider = fn; }

function isValidCommand(cmd) {
  return COMMANDS.includes(cmd);
}

// هل الأمر مسموح دلوقتي؟
function evaluate(cmd) {
  if (!isValidCommand(cmd)) {
    return { allowed: false, code: 'UNKNOWN_COMMAND', message: 'أمر غير معروف' };
  }
  if (RESTRICTED.has(cmd)) {
    const alarm = alarmProvider();
    if (alarm.active) {
      return {
        allowed: false,
        code: 'BLOCKED_ACTIVE_ALARM',
        message: alarm.valveLatched
          ? 'ممنوع أثناء إنذار نشط — الصمام مقفول بالكاميرا لحد ما تعملي Reset بعد التأكد'
          : `ممنوع أثناء إنذار نشط (${alarm.label})`,
      };
    }
  }
  return { allowed: true };
}

// بيطبق الأمر على الـ overrides ويرجّع الحالة الجديدة
function apply(cmd) {
  switch (cmd) {
    case 'valve_close': return overrides.set({ valveClosed: true });
    case 'valve_open':  return overrides.set({ valveClosed: false });
    case 'power_cut':   return overrides.set({ powerCut: true });
    case 'power_on':    return overrides.set({ powerCut: false });
    case 'alarm_off':   return overrides.set({ buzzerMutedUntil: Date.now() + overrides.MUTE_MS });
    default: return overrides.get();
  }
}

module.exports = { COMMANDS, isValidCommand, evaluate, apply, setAlarmProvider };
