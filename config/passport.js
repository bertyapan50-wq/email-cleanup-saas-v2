const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const ConnectedAccount = require('../models/ConnectedAccount'); // ✅ ADD THIS

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      accessType: 'offline',
      prompt: 'consent',
      passReqToCallback: true,
      // ✅ ADD THIS: Define all required Gmail scopes
      scope: [
  'profile',
  'email',
  'https://mail.google.com/',  // ✅ FULL GMAIL ACCESS (includes delete)
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.filters'
]
    },
    async (req, accessToken, refreshToken, params, profile, done) => {
      try {
        console.log('🔵 Google OAuth - Profile received');
        console.log('🔑 Google ID:', profile.id);
        console.log('📧 Email:', profile.emails?.[0]?.value);
        console.log('🔐 Scopes:', params.scope);  // ✅ Log scope

        const email = profile.emails[0].value; // ✅ Store email in variable

        let user = await User.findOne({ googleId: profile.id });

        // ✅ COMPLETE tokens object with ALL fields
        const tokens = {
          access_token: accessToken,
          refresh_token: refreshToken,
          scope: params.scope,                    // ✅ ADD scope
          token_type: params.token_type || 'Bearer',  // ✅ ADD token_type
          expiry_date: params.expiry_date || (Date.now() + (params.expires_in * 1000))  // ✅ ADD expiry
        };

        console.log('✅ Token scopes saved:', tokens.scope);

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: email,
            name: profile.displayName,
            picture: profile.photos?.[0]?.value,
            googleTokens: tokens
          });

          console.log('✅ New user created:', user.email);
        } else {
          // ⚠️ Google may NOT resend refresh_token
          user.googleTokens = {
            access_token: accessToken,
            refresh_token: refreshToken || user.googleTokens?.refresh_token,
            scope: params.scope,                    // ✅ UPDATE scope
            token_type: params.token_type || 'Bearer',
            expiry_date: params.expiry_date || (Date.now() + (params.expires_in * 1000))
          };

          user.lastLogin = new Date();
          await user.save();

          console.log('✅ Existing user updated:', user.email);
          console.log('✅ Updated token scopes:', user.googleTokens.scope);
        }

        // ==================== ✅ NEW: CREATE OR UPDATE CONNECTED ACCOUNT ====================
        try {
          let connectedAccount = await ConnectedAccount.findOne({
            userId: user._id,
            email: email
          });

          if (!connectedAccount) {
            // Create new ConnectedAccount
            connectedAccount = await ConnectedAccount.create({
              userId: user._id,
              email: email,
              provider: 'gmail',
              status: 'connected',
              isPrimary: true, // First account is always primary
              accessToken: accessToken,
              refreshToken: refreshToken,
              tokenExpiry: new Date(Date.now() + ((params.expires_in || 3600) * 1000)),
              permissions: ['read', 'send', 'modify', 'delete'],
              lastSync: new Date(),
              lastSuccessfulSync: new Date(),
              syncStatus: 'idle',
              emailsProcessed: 0,
              emailsSynced: 0,
              settings: {
                autoSync: true,
                syncInterval: 300000, // 5 minutes
                syncLabels: true,
                syncAttachments: false
              },
              connectedAt: new Date(),
              lastUsed: new Date()
            });

            console.log('✅ ConnectedAccount created:', email);
          } else {
            // Update existing ConnectedAccount tokens
            connectedAccount.accessToken = accessToken;
            if (refreshToken) {
              connectedAccount.refreshToken = refreshToken;
            }
            connectedAccount.tokenExpiry = new Date(Date.now() + ((params.expires_in || 3600) * 1000));
            connectedAccount.status = 'connected';
            connectedAccount.lastUsed = new Date();
            await connectedAccount.save();

            console.log('✅ ConnectedAccount updated:', email);
          }
        } catch (connectedAccountError) {
          // Don't fail the whole login if ConnectedAccount creation fails
          console.error('⚠️ Error creating/updating ConnectedAccount:', connectedAccountError);
          console.log('⚠️ User login will continue without ConnectedAccount');
        }
        // ==================== END CONNECTED ACCOUNT LOGIC ====================

        return done(null, user);

      } catch (error) {
        console.error('❌ Passport OAuth error:', error);
        return done(error, null);
      }
    }
  )
);

/**
 * 🔐 Session handling
 * Keep session SMALL – DB is source of truth
 */
passport.serializeUser((user, done) => {
  console.log('📦 Serializing user:', user.email);
  done(null, { _id: user._id });
});

passport.deserializeUser(async (sessionUser, done) => {
  try {
    console.log('📂 Deserializing user:', sessionUser._id);
    const user = await User.findById(sessionUser._id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;