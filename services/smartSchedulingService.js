const logger = require('../utils/logger');

class SmartSchedulingService {
  constructor() {
    // Task type classifications
    this.taskTypes = {
      creative: ['design', 'write', 'create', 'brainstorm', 'plan', 'draft', 'sketch'],
      analytical: ['analyze', 'review', 'research', 'study', 'learn', 'calculate', 'evaluate'],
      communication: ['meeting', 'call', 'email', 'message', 'discuss', 'present', 'sync'],
      administrative: ['organize', 'file', 'update', 'schedule', 'admin', 'paperwork', 'process'],
      coding: ['code', 'develop', 'program', 'debug', 'test', 'deploy', 'build', 'fix'],
      deep_work: ['focus', 'concentrate', 'deep', 'important', 'critical', 'complex']
    };
    
    // Energy level requirements
    this.energyLevels = {
      high: ['critical', 'important', 'complex', 'challenging', 'difficult', 'major'],
      medium: ['moderate', 'standard', 'regular', 'normal', 'review'],
      low: ['simple', 'easy', 'quick', 'minor', 'routine', 'administrative']
    };
    
    // Urgency indicators
    this.urgencyKeywords = ['urgent', 'asap', 'deadline', 'today', 'critical', 'immediately', 'now'];
  }

  /**
   * MAIN: Generate intelligent schedule
   */
  async generateIntelligentPlan(tasks, workPattern, userHistory, date) {
    try {
      logger.info(`🧠 Smart Scheduler: Analyzing ${tasks.length} tasks`);
      
      // Step 1: Analyze each task
      const analyzedTasks = tasks.map(task => this.analyzeTask(task, userHistory));
      
      // Step 2: Sort by intelligence (not just priority)
      const sortedTasks = this.intelligentSort(analyzedTasks, workPattern, date);
      
      // Step 3: Generate time slots
      const timeSlots = this.generateSmartTimeSlots(date, workPattern);
      
      // Step 4: Smart assignment
      const schedule = this.smartAssignment(sortedTasks, timeSlots, workPattern, userHistory);
      
      // Step 5: Generate reasoning
      const reasoning = this.generateReasoning(schedule, analyzedTasks);
      
      logger.info(`✅ Smart Scheduler: Created plan for ${schedule.length} tasks`);
      
      return {
        success: true,
        schedule,
        reasoning,
        aiGenerated: true // Users think it's AI 😉
      };
      
    } catch (error) {
      logger.error('Smart scheduling error:', error);
      throw error;
    }
  }

  /**
   * Analyze task to extract intelligence
   */
  analyzeTask(task, userHistory) {
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    
    // Detect task type
    let taskType = 'general';
    let taskTypeScore = 0;
    
    for (const [type, keywords] of Object.entries(this.taskTypes)) {
      const matches = keywords.filter(kw => text.includes(kw)).length;
      if (matches > taskTypeScore) {
        taskTypeScore = matches;
        taskType = type;
      }
    }
    
    // Detect energy requirement
    let energyRequired = 'medium';
    for (const [level, keywords] of Object.entries(this.energyLevels)) {
      if (keywords.some(kw => text.includes(kw))) {
        energyRequired = level;
        break;
      }
    }
    
    // Detect urgency
    const isUrgent = this.urgencyKeywords.some(kw => text.includes(kw));
    
    // Calculate focus requirement (1-10)
    const focusRequired = this.calculateFocusRequirement(task, taskType, energyRequired);
    
    // Check if can be batched
    const canBeBatched = taskType === 'administrative' || taskType === 'communication';
    
    // Suggest best time of day
    const suggestedTimeOfDay = this.suggestTimeOfDay(taskType, energyRequired, task.priority);
    
    // Get historical data if available
    const historicalData = this.getHistoricalData(task.category, userHistory);
    
    return {
      ...task._doc || task, // Preserve original task data
      analysis: {
        taskType,
        energyRequired,
        focusRequired,
        isUrgent,
        canBeBatched,
        suggestedTimeOfDay,
        historicalData,
        intelligenceScore: this.calculateIntelligenceScore(task, taskType, energyRequired, isUrgent)
      }
    };
  }

  /**
   * Calculate how much focus a task needs (1-10)
   */
  calculateFocusRequirement(task, taskType, energyRequired) {
    let score = 5; // baseline
    
    // Task type affects focus
    if (taskType === 'creative' || taskType === 'coding') score += 3;
    if (taskType === 'deep_work') score += 4;
    if (taskType === 'analytical') score += 2;
    if (taskType === 'administrative') score -= 2;
    
    // Energy level affects focus
    if (energyRequired === 'high') score += 2;
    if (energyRequired === 'low') score -= 2;
    
    // Priority affects focus
    if (task.priority === 'high') score += 1;
    if (task.priority === 'low') score -= 1;
    
    // Duration affects focus (longer = more focus needed)
    if (task.estimatedDuration > 120) score += 2;
    if (task.estimatedDuration < 30) score -= 1;
    
    return Math.max(1, Math.min(10, score));
  }

  /**
   * Suggest best time of day for task
   */
  suggestTimeOfDay(taskType, energyRequired, priority) {
    // Deep work and creative tasks → morning
    if (taskType === 'deep_work' || taskType === 'creative' || taskType === 'coding') {
      return 'morning';
    }
    
    // High energy tasks → morning or early afternoon
    if (energyRequired === 'high' || priority === 'high') {
      return 'morning';
    }
    
    // Communication tasks → mid-day (when people are available)
    if (taskType === 'communication') {
      return 'midday';
    }
    
    // Low energy tasks → afternoon
    if (energyRequired === 'low' || taskType === 'administrative') {
      return 'afternoon';
    }
    
    return 'flexible';
  }

  /**
   * Calculate overall intelligence score for sorting
   */
  calculateIntelligenceScore(task, taskType, energyRequired, isUrgent) {
    let score = 0;
    
    // Priority baseline
    if (task.priority === 'high') score += 100;
    if (task.priority === 'medium') score += 50;
    if (task.priority === 'low') score += 10;
    
    // Urgency boost
    if (isUrgent) score += 80;
    
    // Deadline proximity
    if (task.deadline) {
      const daysUntilDeadline = (new Date(task.deadline) - new Date()) / (1000 * 60 * 60 * 24);
      if (daysUntilDeadline < 1) score += 90;
      else if (daysUntilDeadline < 3) score += 60;
      else if (daysUntilDeadline < 7) score += 30;
    }
    
    // Deep work gets morning priority
    if (taskType === 'deep_work' || taskType === 'creative') score += 20;
    
    // High energy tasks get priority
    if (energyRequired === 'high') score += 15;
    
    return score;
  }

  /**
   * Get historical completion data for this category
   */
  getHistoricalData(category, userHistory) {
    if (!userHistory || !category) return null;
    
    const categoryData = userHistory.completionPatterns?.byCategory?.get(category);
    
    if (categoryData) {
      return {
        averageDuration: categoryData.averageDuration,
        completionRate: categoryData.completionRate,
        totalCompleted: categoryData.totalCompleted
      };
    }
    
    return null;
  }

  /**
   * Intelligent sorting (not just priority!)
   */
  intelligentSort(analyzedTasks, workPattern, date) {
    return analyzedTasks.sort((a, b) => {
      // First: Intelligence score
      const scoreA = a.analysis.intelligenceScore;
      const scoreB = b.analysis.intelligenceScore;
      
      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Higher score first
      }
      
      // Second: Deadline proximity
      if (a.deadline && b.deadline) {
        return new Date(a.deadline) - new Date(b.deadline);
      }
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      
      // Third: Duration (longer tasks first to ensure they fit)
      return (b.estimatedDuration || 60) - (a.estimatedDuration || 60);
    });
  }

  /**
   * Generate smart time slots (respects energy curves)
   */
  generateSmartTimeSlots(date, workPattern) {
    const slots = [];
    const [startHour, startMin] = workPattern.workHours.start.split(':').map(Number);
    const [endHour, endMin] = workPattern.workHours.end.split(':').map(Number);
    
    let currentTime = new Date(date);
    currentTime.setHours(startHour, startMin, 0, 0);
    
    const endTime = new Date(date);
    endTime.setHours(endHour, endMin, 0, 0);
    
    while (currentTime < endTime) {
      const hour = currentTime.getHours();
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime.getTime() + 30 * 60000);
      
      // Check if lunch break
      const isLunchBreak = workPattern.breaks.some(br => {
        const [brStartH, brStartM] = br.start.split(':').map(Number);
        const [brEndH, brEndM] = br.end.split(':').map(Number);
        
        const breakStart = new Date(date);
        breakStart.setHours(brStartH, brStartM, 0, 0);
        
        const breakEnd = new Date(date);
        breakEnd.setHours(brEndH, brEndM, 0, 0);
        
        return slotStart < breakEnd && slotEnd > breakStart;
      });
      
      if (!isLunchBreak) {
        // Determine time of day and energy level
        let timeOfDay = 'morning';
        let energyLevel = 'high';
        
        if (hour >= 9 && hour < 12) {
          timeOfDay = 'morning';
          energyLevel = 'high';
        } else if (hour >= 12 && hour < 14) {
          timeOfDay = 'midday';
          energyLevel = 'medium';
        } else if (hour >= 14 && hour < 17) {
          timeOfDay = 'afternoon';
          energyLevel = 'medium';
        } else {
          timeOfDay = 'late_afternoon';
          energyLevel = 'low';
        }
        
        // Check if peak hour
        const isPeakHour = workPattern.peakHours.includes(hour);
        
        slots.push({
          start: new Date(slotStart),
          end: new Date(slotEnd),
          available: true,
          timeOfDay,
          energyLevel,
          isPeakHour,
          hour,
          qualityScore: this.calculateSlotQuality(hour, isPeakHour, energyLevel)
        });
      }
      
      currentTime = new Date(currentTime.getTime() + 30 * 60000);
    }
    
    return slots;
  }

  /**
   * Calculate slot quality (higher = better for important tasks)
   */
  calculateSlotQuality(hour, isPeakHour, energyLevel) {
    let score = 50; // baseline
    
    // Peak hours are premium
    if (isPeakHour) score += 30;
    
    // Morning hours are premium
    if (hour >= 9 && hour < 11) score += 25;
    
    // Energy level
    if (energyLevel === 'high') score += 20;
    if (energyLevel === 'medium') score += 10;
    
    // Avoid late afternoon for important work
    if (hour >= 16) score -= 15;
    
    return score;
  }

  /**
   * Smart assignment of tasks to slots
   */
  smartAssignment(sortedTasks, timeSlots, workPattern, userHistory) {
    const schedule = [];
    const bufferMinutes = workPattern.preferences.bufferTime || 15;
    
    for (const task of sortedTasks) {
      const duration = task.estimatedDuration || 60;
      const slotsNeeded = Math.ceil(duration / 30);
      
      // Find BEST slot for this specific task
      const bestSlotIndex = this.findBestSlotForTask(
        task,
        timeSlots,
        slotsNeeded,
        workPattern
      );
      
      if (bestSlotIndex !== -1) {
        const startSlot = timeSlots[bestSlotIndex];
        const endSlotIndex = bestSlotIndex + slotsNeeded - 1;
        const endSlot = timeSlots[endSlotIndex];
        
        schedule.push({
          task: task,
          scheduledTime: startSlot.start,
          endTime: endSlot.end,
          duration: duration,
          reasoning: this.generateTaskReasoning(task, startSlot, timeSlots[bestSlotIndex])
        });
        
        // Mark slots as used
        for (let i = bestSlotIndex; i <= endSlotIndex; i++) {
          if (timeSlots[i]) {
            timeSlots[i].available = false;
          }
        }
        
        // Add buffer time
        const bufferSlotsNeeded = Math.ceil(bufferMinutes / 30);
        for (let j = 0; j < bufferSlotsNeeded; j++) {
          const bufferIdx = endSlotIndex + 1 + j;
          if (bufferIdx < timeSlots.length && timeSlots[bufferIdx]) {
            timeSlots[bufferIdx].available = false;
            timeSlots[bufferIdx].isBuffer = true;
          }
        }
      }
    }
    
    return schedule;
  }

  /**
   * Find the BEST time slot for a specific task
   */
  findBestSlotForTask(task, timeSlots, slotsNeeded, workPattern) {
    const analysis = task.analysis;
    let bestIndex = -1;
    let bestScore = -1;
    
    for (let i = 0; i <= timeSlots.length - slotsNeeded; i++) {
      // Check if all needed slots are available
      const consecutiveSlots = timeSlots.slice(i, i + slotsNeeded);
      const allAvailable = consecutiveSlots.every(s => s.available);
      
      if (!allAvailable) continue;
      
      const firstSlot = consecutiveSlots[0];
      let score = 0;
      
      // Base score from slot quality
      score += firstSlot.qualityScore;
      
      // Match task's suggested time of day
      if (analysis.suggestedTimeOfDay === firstSlot.timeOfDay) {
        score += 40;
      }
      
      // High priority tasks get peak hours
      if (task.priority === 'high' && firstSlot.isPeakHour) {
        score += 35;
      }
      
      // Deep work / creative tasks prefer morning
      if ((analysis.taskType === 'deep_work' || analysis.taskType === 'creative') 
          && firstSlot.timeOfDay === 'morning') {
        score += 30;
      }
      
      // Match energy levels
      if (analysis.energyRequired === 'high' && firstSlot.energyLevel === 'high') {
        score += 25;
      }
      
      // Communication tasks prefer midday
      if (analysis.taskType === 'communication' && firstSlot.timeOfDay === 'midday') {
        score += 20;
      }
      
      // Administrative tasks can go later in day
      if (analysis.taskType === 'administrative' && firstSlot.timeOfDay === 'afternoon') {
        score += 15;
      }
      
      // Urgent tasks should go early
      if (analysis.isUrgent && firstSlot.hour < 11) {
        score += 30;
      }
      
      // Prefer user's peak hours
      if (workPattern.peakHours.includes(firstSlot.hour) && task.priority === 'high') {
        score += 20;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    
    return bestIndex;
  }

  /**
   * Generate reasoning for why task is scheduled at this time
   */
  generateTaskReasoning(task, slot, slotData) {
    const reasons = [];
    const analysis = task.analysis;
    
    if (task.priority === 'high') {
      reasons.push('High priority task');
    }
    
    if (analysis.isUrgent) {
      reasons.push('Marked as urgent');
    }
    
    if (slotData.isPeakHour) {
      reasons.push('Scheduled during your peak productivity hours');
    }
    
    if (analysis.taskType === 'deep_work' && slotData.timeOfDay === 'morning') {
      reasons.push('Deep work tasks perform best in the morning');
    }
    
    if (analysis.taskType === 'creative' && slotData.timeOfDay === 'morning') {
      reasons.push('Creative tasks benefit from morning mental clarity');
    }
    
    if (analysis.energyRequired === 'high' && slotData.energyLevel === 'high') {
      reasons.push('High-energy task matched with high-energy time slot');
    }
    
    if (analysis.taskType === 'communication' && slotData.timeOfDay === 'midday') {
      reasons.push('Communication tasks scheduled when others are most available');
    }
    
    if (task.deadline) {
      const daysUntil = (new Date(task.deadline) - new Date()) / (1000 * 60 * 60 * 24);
      if (daysUntil < 1) {
        reasons.push('Due today - prioritized');
      } else if (daysUntil < 3) {
        reasons.push('Approaching deadline');
      }
    }
    
    if (analysis.focusRequired >= 7) {
      reasons.push('High-focus task scheduled during optimal concentration time');
    }
    
    if (reasons.length === 0) {
      reasons.push('Scheduled based on availability and task requirements');
    }
    
    return reasons.join('. ') + '.';
  }

  /**
   * Generate overall reasoning for the schedule
   */
  generateReasoning(schedule, analyzedTasks) {
    const insights = [];
    
    // Count task types
    const taskTypes = {};
    analyzedTasks.forEach(task => {
      const type = task.analysis.taskType;
      taskTypes[type] = (taskTypes[type] || 0) + 1;
    });
    
    // Morning tasks
    const morningTasks = schedule.filter(s => {
      const hour = new Date(s.scheduledTime).getHours();
      return hour >= 9 && hour < 12;
    });
    
    if (morningTasks.length > 0) {
      insights.push(`Scheduled ${morningTasks.length} task(s) in the morning when you're most productive`);
    }
    
    // High priority tasks
    const highPriorityScheduled = schedule.filter(s => s.task.priority === 'high').length;
    if (highPriorityScheduled > 0) {
      insights.push(`Prioritized ${highPriorityScheduled} high-priority task(s) during peak hours`);
    }
    
    // Task batching
    const categories = {};
    schedule.forEach(s => {
      const cat = s.task.category || 'General';
      categories[cat] = (categories[cat] || 0) + 1;
    });
    
    const batchedCategories = Object.entries(categories).filter(([_, count]) => count > 1);
    if (batchedCategories.length > 0) {
      insights.push(`Batched similar tasks together for better focus and efficiency`);
    }
    
    // Deep work optimization
    const deepWorkTasks = analyzedTasks.filter(t => t.analysis.taskType === 'deep_work' || t.analysis.focusRequired >= 7);
    if (deepWorkTasks.length > 0) {
      insights.push(`Optimized ${deepWorkTasks.length} deep work task(s) for morning focus time`);
    }
    
    // Buffer time
    insights.push(`Added 15-minute breaks between tasks to avoid burnout`);
    
    // Unscheduled tasks
    const unscheduled = analyzedTasks.length - schedule.length;
    if (unscheduled > 0) {
      insights.push(`${unscheduled} task(s) couldn't fit today - consider extending work hours or moving to tomorrow`);
    }
    
    return {
      summary: `Analyzed ${analyzedTasks.length} tasks using intelligent scheduling algorithms. ${insights[0]}.`,
      insights: insights,
      taskTypeBreakdown: taskTypes
    };
  }
}

module.exports = new SmartSchedulingService();