const mongoose = require('mongoose');

console.log('🔄 Loading UserWorkPattern model...');

const userWorkPatternSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // Work Hours
  workHours: {
    start: {
      type: String,
      default: '09:00'
    },
    end: {
      type: String,
      default: '17:00'
    },
    timezone: {
      type: String,
      default: 'Asia/Manila'
    }
  },
  
  // Break Times
  breaks: [{
    name: String,
    start: String,
    end: String
  }],
  
  // Peak Productivity Hours - ✅ FIXED
  peakHours: {
    type: [Number], // Array of numbers
    default: [9, 10, 14, 15] // Default value
  },
  
  // Task Completion Patterns
  completionPatterns: {
    byHour: {
      type: Map,
      of: Number,
      default: new Map()
    },
    byDayOfWeek: {
      type: Map,
      of: Number,
      default: new Map()
    },
    byCategory: {
      type: Map,
      of: {
        averageDuration: Number,
        completionRate: Number,
        totalCompleted: Number
      },
      default: new Map()
    }
  },
  
  // Duration Accuracy
  durationAccuracy: {
    totalTasks: {
      type: Number,
      default: 0
    },
    accurateEstimates: {
      type: Number,
      default: 0
    },
    averageVariance: {
      type: Number,
      default: 0
    }
  },
  
  // Preferences
  preferences: {
    bufferTime: {
      type: Number,
      default: 15
    },
    maxTasksPerDay: {
      type: Number,
      default: 8
    },
    preferMorning: {
      type: Boolean,
      default: true
    },
    batchSimilarTasks: {
      type: Boolean,
      default: true
    }
  },
  
  // Learning Stats
  totalTasksAnalyzed: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Methods
userWorkPatternSchema.methods.recordCompletion = function(task) {
  const hour = new Date(task.scheduledTime).getHours();
  const dayOfWeek = new Date(task.scheduledTime).getDay();
  
  // Update completion by hour
  const hourKey = hour.toString();
  const currentHourCount = this.completionPatterns.byHour.get(hourKey) || 0;
  this.completionPatterns.byHour.set(hourKey, currentHourCount + 1);
  
  // Update completion by day
  const dayKey = dayOfWeek.toString();
  const currentDayCount = this.completionPatterns.byDayOfWeek.get(dayKey) || 0;
  this.completionPatterns.byDayOfWeek.set(dayKey, currentDayCount + 1);
  
  // Update category patterns
  if (task.category) {
    const categoryData = this.completionPatterns.byCategory.get(task.category) || {
      averageDuration: 0,
      completionRate: 0,
      totalCompleted: 0
    };
    
    if (task.actualDuration) {
      const totalDuration = categoryData.averageDuration * categoryData.totalCompleted;
      categoryData.totalCompleted += 1;
      categoryData.averageDuration = (totalDuration + task.actualDuration) / categoryData.totalCompleted;
    }
    
    this.completionPatterns.byCategory.set(task.category, categoryData);
  }
  
  // Update duration accuracy
  if (task.actualDuration && task.estimatedDuration) {
    const variance = Math.abs(task.actualDuration - task.estimatedDuration) / task.estimatedDuration;
    const totalVariance = this.durationAccuracy.averageVariance * this.durationAccuracy.totalTasks;
    
    this.durationAccuracy.totalTasks += 1;
    this.durationAccuracy.averageVariance = (totalVariance + variance) / this.durationAccuracy.totalTasks;
    
    if (variance < 0.2) { // Within 20% = accurate
      this.durationAccuracy.accurateEstimates += 1;
    }
  }
  
  this.totalTasksAnalyzed += 1;
  this.lastUpdated = new Date();
  
  return this.save();
};

userWorkPatternSchema.methods.getBestTimeForTask = function(category, duration) {
  // Get peak hours
  const peakHours = this.peakHours || [9, 10, 14, 15];
  
  // Check category patterns
  const categoryData = this.completionPatterns.byCategory.get(category);
  
  // Return recommended hour based on patterns
  if (categoryData && categoryData.totalCompleted > 5) {
    // Use learned patterns
    return peakHours[0]; // Simplified - in production, analyze more deeply
  }
  
  // Default to first peak hour
  return peakHours[0];
};

const UserWorkPattern = mongoose.model('UserWorkPattern', userWorkPatternSchema);

console.log('✅ UserWorkPattern model compiled:', UserWorkPattern.modelName);

module.exports = UserWorkPattern;
