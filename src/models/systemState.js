const mongoose = require('mongoose');

// حالات النظام اللي لازم تفضل بعد restart (زي قفل الصمام)
const systemStateSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SystemState', systemStateSchema);
