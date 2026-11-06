const passport = require('passport');
const User = require('../models/user');

// Google Strategy - بس لو في credentials
if (process.env.GOOGLE_CLIENT_ID && 
    process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id') {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/api/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ google_id: profile.id });
      if (user) return done(null, user);

      user = await User.findOne({ email: profile.emails[0].value });
      if (user) {
        user.google_id = profile.id;
        user.email_verified = true;
        await user.save();
        return done(null, user);
      }

      user = await User.create({
        google_id: profile.id,
        username: profile.displayName.replace(/\s/g, '_') + '_' + Date.now(),
        email: profile.emails[0].value,
        first_name: profile.name.givenName || '',
        last_name: profile.name.familyName || '',
        password: require('crypto').randomBytes(32).toString('hex'),
        email_verified: true,
        is_oauth_user: true
      });
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
  console.log('✅ Google OAuth enabled');
}

// Facebook Strategy - بس لو في credentials
if (process.env.FACEBOOK_APP_ID && 
    process.env.FACEBOOK_APP_ID !== 'your_facebook_app_id') {
  const FacebookStrategy = require('passport-facebook').Strategy;
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: '/api/auth/facebook/callback',
    profileFields: ['id', 'emails', 'name', 'displayName']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ facebook_id: profile.id });
      if (user) return done(null, user);

      const email = profile.emails?.[0]?.value;
      if (email) {
        user = await User.findOne({ email });
        if (user) {
          user.facebook_id = profile.id;
          user.email_verified = true;
          await user.save();
          return done(null, user);
        }
      }

      user = await User.create({
        facebook_id: profile.id,
        username: (profile.displayName || 'user').replace(/\s/g, '_') + '_' + Date.now(),
        email: email || `fb_${profile.id}@placeholder.com`,
        first_name: profile.name?.givenName || '',
        last_name: profile.name?.familyName || '',
        password: require('crypto').randomBytes(32).toString('hex'),
        email_verified: true,
        is_oauth_user: true
      });
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
  console.log('✅ Facebook OAuth enabled');
}

module.exports = passport;