// =====================
// MIGRATION SCRIPT: Sync Existing Subscriptions
// Run this once to sync User model data to Subscription model
// Usage: node migrate-subscriptions.js
// =====================

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Subscription = require('./models/Subscription');

async function migrateSubscriptions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all users with active subscriptions
    const users = await User.find({
      subscriptionTier: { $in: ['pro', 'premium', 'enterprise'] }
    });

    console.log(`📊 Found ${users.length} users with premium subscriptions`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        // Check if subscription already exists
        let subscription = await Subscription.findOne({ userId: user._id });

        const subscriptionData = {
          plan: user.subscriptionTier,
          status: user.subscriptionStatus || 'active',
          provider: user.paymongoSubscriptionId ? 'paymongo' : user.stripeSubscriptionId ? 'stripe' : 'free',
          subscriptionId: user.paymongoSubscriptionId || user.stripeSubscriptionId,
          checkoutSessionId: user.paymongoCheckoutSessionId,
          currentPeriodEnd: user.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          billingCycle: 'monthly' // Default to monthly
        };

        if (!subscription) {
          // Create new subscription
          subscription = await Subscription.create({
            userId: user._id,
            ...subscriptionData,
            currentPeriodStart: user.createdAt || new Date(),
            paymentHistory: [] // Will be empty for old subscriptions
          });
          created++;
          console.log(`✅ Created subscription for ${user.email}`);
        } else {
          // Update existing subscription
          Object.assign(subscription, subscriptionData);
          await subscription.save();
          updated++;
          console.log(`🔄 Updated subscription for ${user.email}`);
        }

      } catch (error) {
        console.error(`❌ Error processing user ${user.email}:`, error.message);
        skipped++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${users.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Migration completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateSubscriptions();