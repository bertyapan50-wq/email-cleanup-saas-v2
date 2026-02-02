require('dotenv').config();
const mongoose = require('mongoose');
const Referral = require('./models/Referral');

async function removeDuplicates() {
  try {
    console.log('🔄 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected!\n');

    // Get all referrals sorted by creation date
    const referrals = await Referral.find({}).sort({ createdAt: 1 });
    console.log(`📊 Total referrals found: ${referrals.length}\n`);

    const emailMap = new Map();
    const toDelete = [];

    // Group by email and find duplicates
    referrals.forEach(ref => {
      const email = (ref.referredEmail || 'N/A').toLowerCase();
      
      if (emailMap.has(email)) {
        // Duplicate found - mark for deletion
        toDelete.push(ref);
        console.log(`🔍 Duplicate found: ${email} (ID: ${ref._id})`);
      } else {
        // First occurrence - keep it
        emailMap.set(email, ref);
        console.log(`✅ Keeping: ${email} (${ref.status}) - Created: ${ref.createdAt}`);
      }
    });

    console.log(`\n📊 Analysis:`);
    console.log(`   Total referrals: ${referrals.length}`);
    console.log(`   Unique emails: ${emailMap.size}`);
    console.log(`   Duplicates to remove: ${toDelete.length}`);

    if (toDelete.length === 0) {
      console.log('\n✅ No duplicates found!');
      await mongoose.disconnect();
      process.exit(0);
      return;
    }

    // Delete duplicates
    console.log('\n🗑️  Removing duplicates...');
    for (const ref of toDelete) {
      await Referral.deleteOne({ _id: ref._id });
      console.log(`   Deleted: ${ref.referredEmail} (ID: ${ref._id})`);
    }

    console.log(`\n✅ Successfully removed ${toDelete.length} duplicates!`);
    console.log(`✅ Remaining referrals: ${emailMap.size}`);

    await mongoose.disconnect();
    console.log('\n✅ Done! Database cleaned.');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

removeDuplicates();