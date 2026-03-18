const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://admin:G6rA7H0z4CNEeK2q@cluster0.lt7i9iw.mongodb.net/email-cleanup?retryWrites=true&w=majority').then(async () => {
  const result = await mongoose.connection.db.collection('users').updateOne(
    { email: 'jayalbert2022@gmail.com' },
    { 
      $set: { 
        subscriptionTier: 'premium',
        trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        freeCleanupCount: 999
      } 
    }
  );
  console.log('✅ Unlocked! Modified:', result.modifiedCount);
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});