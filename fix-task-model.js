console.log('🔧 Testing Task model compilation...\n');

const mongoose = require('mongoose');
require('dotenv').config();

// Connect
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gmail-cleanup', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB error:', err.message);
  process.exit(1);
});

// Clear existing model if any
if (mongoose.models.Task) {
  delete mongoose.models.Task;
  console.log('🗑️  Cleared existing Task model');
}

// Load fresh
const Task = require('./models/Task');

console.log('\n📊 Task Model Info:');
console.log('- Model name:', Task.modelName);
console.log('- Collection:', Task.collection.name);
console.log('- Has create?', typeof Task.create === 'function' ? '✅' : '❌');
console.log('- Has find?', typeof Task.find === 'function' ? '✅' : '❌');
console.log('- Has save?', Task.prototype && typeof Task.prototype.save === 'function' ? '✅' : '❌');

// Test create
async function testCreate() {
  try {
    console.log('\n🧪 Testing Task.create()...');
    
    const testTask = await Task.create({
      userId: new mongoose.Types.ObjectId(),
      title: 'Test Task',
      priority: 'high',
      estimatedDuration: 60
    });
    
    console.log('✅ Task created successfully!');
    console.log('   ID:', testTask._id);
    console.log('   Title:', testTask.title);
    
    // Clean up
    await Task.deleteMany({ title: 'Test Task' });
    console.log('🗑️  Test data cleaned up');
    
    console.log('\n🎉 TASK MODEL IS WORKING PERFECTLY!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

setTimeout(testCreate, 1000);