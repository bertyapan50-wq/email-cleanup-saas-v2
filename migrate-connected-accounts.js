const mongoose = require('mongoose');
const User = require('./models/User');
const ConnectedAccount = require('./models/ConnectedAccount');
require('dotenv').config();

async function migrateExistingUsers() {
  try {
    console.log('🚀 Starting migration...\n');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all users with Google tokens
    const users = await User.find({
      email: { $exists: true },
      googleTokens: { $exists: true }
    });

    console.log(`📧 Found ${users.length} users to migrate\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Check if account already exists
        const existing = await ConnectedAccount.findOne({
          userId: user._id,
          email: user.email
        });

        if (existing) {
          console.log(`⏭️  Skipping ${user.email} - already exists`);
          skipped++;
          continue;
        }

        // Extract tokens from user.googleTokens
        const accessToken = user.googleTokens?.access_token;
        const refreshToken = user.googleTokens?.refresh_token || user.refreshToken;
        const tokenExpiry = user.googleTokens?.expiry_date 
          ? new Date(user.googleTokens.expiry_date) 
          : null;

        if (!accessToken || !refreshToken) {
          console.log(`⚠️  Skipping ${user.email} - missing tokens`);
          skipped++;
          continue;
        }

        // Create connected account
        const account = await ConnectedAccount.create({
          userId: user._id,
          provider: 'gmail',
          email: user.email,
          accessToken: accessToken,
          refreshToken: refreshToken,
          tokenExpiry: tokenExpiry,
          isPrimary: true, // First account is always primary
          status: 'connected',
          permissions: ['read', 'send', 'modify'],
          lastSync: new Date(),
          settings: {
            autoSync: true,
            syncInterval: 300000,
            syncLabels: true,
            syncAttachments: false
          }
        });

        console.log(`✅ Migrated: ${user.email}`);
        migrated++;

      } catch (error) {
        console.error(`❌ Error migrating ${user.email}:`, error.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(50));
    console.log(`✅ Successfully Migrated: ${migrated}`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📧 Total Users: ${users.length}`);
    console.log('='.repeat(50) + '\n');

    await mongoose.connection.close();
    console.log('✅ Migration complete! Database connection closed.\n');
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateExistingUsers();
EOF
cat /home/claude/migrate-connected-accounts.js
Output

// migrate-connected-accounts.js
// ✅ RUN THIS ONCE: node migrate-connected-accounts.js

const mongoose = require('mongoose');
const User = require('./models/User');
const ConnectedAccount = require('./models/ConnectedAccount');
require('dotenv').config();

async function migrateExistingUsers() {
  try {
    console.log('🚀 Starting migration...\n');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all users with Google tokens
    const users = await User.find({
      email: { $exists: true },
      googleTokens: { $exists: true }
    });

    console.log(`📧 Found ${users.length} users to migrate\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Check if account already exists
        const existing = await ConnectedAccount.findOne({
          userId: user._id,
          email: user.email
        });

        if (existing) {
          console.log(`⏭️  Skipping ${user.email} - already exists`);
          skipped++;
          continue;
        }

        // Extract tokens from user.googleTokens
        const accessToken = user.googleTokens?.access_token;
        const refreshToken = user.googleTokens?.refresh_token || user.refreshToken;
        const tokenExpiry = user.googleTokens?.expiry_date 
          ? new Date(user.googleTokens.expiry_date) 
          : null;

        if (!accessToken || !refreshToken) {
          console.log(`⚠️  Skipping ${user.email} - missing tokens`);
          skipped++;
          continue;
        }

        // Create connected account
        const account = await ConnectedAccount.create({
          userId: user._id,
          provider: 'gmail',
          email: user.email,
          accessToken: accessToken,
          refreshToken: refreshToken,
          tokenExpiry: tokenExpiry,
          isPrimary: true, // First account is always primary
          status: 'connected',
          permissions: ['read', 'send', 'modify'],
          lastSync: new Date(),
          settings: {
            autoSync: true,
            syncInterval: 300000,
            syncLabels: true,
            syncAttachments: false
          }
        });

        console.log(`✅ Migrated: ${user.email}`);
        migrated++;

      } catch (error) {
        console.error(`❌ Error migrating ${user.email}:`, error.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(50));
    console.log(`✅ Successfully Migrated: ${migrated}`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📧 Total Users: ${users.length}`);
    console.log('='.repeat(50) + '\n');

    await mongoose.connection.close();
    console.log('✅ Migration complete! Database connection closed.\n');
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}
