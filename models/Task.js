const mongoose = require('mongoose');

// Clear any existing model
if (mongoose.models.Task) {
  delete mongoose.models.Task;
}

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  estimatedDuration: { type: Number, default: 60 },
  deadline: Date,
  scheduledTime: Date,
  status: { type: String, enum: ['pending', 'scheduled', 'in-progress', 'completed', 'cancelled'], default: 'pending' },
  category: { type: String, default: 'General' },
  tags: [String],
  actualDuration: Number,
  completedAt: Date,
  aiGenerated: { type: Boolean, default: false },
  confidence: { type: Number, default: 80 },
  isRecurring: { type: Boolean, default: false },
  recurrencePattern: { type: String, enum: ['daily', 'weekly', 'monthly', 'none'], default: 'none' }
}, { timestamps: true });

taskSchema.methods.markComplete = function(actualDuration) {
  this.status = 'completed';
  this.completedAt = new Date();
  if (actualDuration) this.actualDuration = actualDuration;
  return this.save();
};

taskSchema.methods.reschedule = function(newTime) {
  this.scheduledTime = newTime;
  this.status = 'scheduled';
  return this.save();
};

const Task = mongoose.model('Task', taskSchema);

// Verify export
console.log('✅ Task model compiled:', Task.modelName);

module.exports = Task;