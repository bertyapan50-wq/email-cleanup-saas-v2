const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
<<<<<<< HEAD
   process.env.GOOGLE_CALLBACK_URL
=======
  process.env.GOOGLE_CALLBACK_URL
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
);

const getAuthUrl = () => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
<<<<<<< HEAD
      'https://www.googleapis.com/auth/gmail.settings.basic'  // ✅ ADDED: Para sa filter creation
=======
      'https://www.googleapis.com/auth/gmail.settings.basic',
      'https://www.googleapis.com/auth/gmail.send'  // ✅ IDAGDAG ITO
>>>>>>> 0cc4553a9e3a96acd13ef280a34e5e73b5b53a3f
    ],
    prompt: 'consent'
  });
};

module.exports = { oauth2Client, getAuthUrl };