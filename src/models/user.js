const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  phone: {
    type: String,
    default: null
  },
  address: {
    type: String,
    default: null
  },
  first_name: {
    type: String,
    default: ''
  },
  last_name: {
    type: String,
    default: ''
  },
  date_of_birth: {
    type: Date,
    default: null
  },
  // Verification
  email_verified: {
    type: Boolean,
    default: false
  },
  verification_code: {
    type: String,
    default: null
  },
  verification_code_created_at: {
    type: Date,
    default: null
  },
  // Reset Password
  reset_token: {
    type: String,
    default: null
  },
  reset_token_created_at: {
    type: Date,
    default: null
  },
  // OAuth
  google_id: {
    type: String,
    default: null
  },
  facebook_id: {
    type: String,
    default: null
  },
  is_oauth_user: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// تشفير الباسورد قبل الحفظ
// تشفير الباسورد قبل الحفظ
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// مقارنة الباسورد
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// الاسم الكامل
userSchema.methods.getFullName = function() {
  if (this.first_name && this.last_name) {
    return `${this.first_name} ${this.last_name}`;
  }
  return this.username;
};

module.exports = mongoose.model('User', userSchema);