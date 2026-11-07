const mqttService = require('../mqtt/mqttService');
const commands = require('../control/commands');
const overrides = require('../control/overrides');

const ACK_TIMEOUT_MS = Number(process.env.ACK_TIMEOUT_MS) || 3000;

// POST /api/devices/:id/command   body: { "cmd": "valve_close" }
const sendDeviceCommand = async (req, res) => {
  const id = String(req.params.id);
  const cmd = req.body && req.body.cmd;

  if (!mqttService.ID_RE.test(id)) {
    return res.status(400).json({ success: false, message: 'device id غير صالح' });
  }
  if (!commands.isValidCommand(cmd)) {
    return res.status(400).json({
      success: false, code: 'UNKNOWN_COMMAND',
      message: `أمر غير معروف. المتاح: ${commands.COMMANDS.join(', ')}`,
    });
  }

  // 1. قواعد الأمان
  const verdict = commands.evaluate(cmd);
  if (!verdict.allowed) {
    return res.status(409).json({ success: false, code: verdict.code, message: verdict.message });
  }

  // 2. نطبّق الأمر ونبعت القرار المحدّث للجهاز (retained: لو الجهاز offline هيستلمه أول ما يرجع)
  const state = commands.apply(cmd);
  console.log(`🎛️ [${id}] ${cmd} by ${req.user?.username || 'unknown'}`);
  mqttService.publishDecision(id);

  // 3. نبعت الأمر وننتظر تأكيد الجهاز
  const result = await mqttService.sendCommand(id, cmd, ACK_TIMEOUT_MS);

  if (result.acked) {
    return res.json({
      success: true, acked: true, ok: result.ok, cmd,
      message: result.ok ? 'الجهاز نفّذ الأمر' : 'الجهاز استلم الأمر لكن ما نفّذوش',
      device: mqttService.getDeviceState(id),
      overrides: state,
    });
  }

  // ما جاش ack: الأمر اتسجّل وهيتنفّذ أول ما الجهاز يتصل (القرار retained / الـ HTTP polling)
  return res.status(202).json({
    success: true, acked: false, cmd, reason: result.reason,
    message: 'الأمر اتسجّل لكن الجهاز ما أكدش خلال المهلة. هيتنفّذ أول ما يتصل.',
    device: mqttService.getDeviceState(id),
    overrides: state,
  });
};

// GET /api/devices/:id/state
const getDeviceState = (req, res) => {
  const id = String(req.params.id);
  if (!mqttService.ID_RE.test(id)) {
    return res.status(400).json({ success: false, message: 'device id غير صالح' });
  }
  res.json({
    success: true,
    data: {
      ...mqttService.getDeviceState(id),
      mqttEnabled: mqttService.isEnabled(),
      mqttConnected: mqttService.isConnected(),
      overrides: overrides.get(),
    },
  });
};

module.exports = { sendDeviceCommand, getDeviceState };
