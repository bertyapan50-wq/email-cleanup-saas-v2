const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createSchedulesTable() {
  try {
    console.log('🚀 Creating schedules table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        
        schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
        time VARCHAR(5) NOT NULL,
        day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
        day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
        timezone VARCHAR(50) DEFAULT 'Asia/Manila',
        
        confidence_level VARCHAR(20) DEFAULT 'high' CHECK (confidence_level IN ('high', 'medium', 'all')),
        categories JSONB DEFAULT '[]',
        action VARCHAR(20) DEFAULT 'archive' CHECK (action IN ('archive', 'delete')),
        
        is_active BOOLEAN DEFAULT true,
        last_run TIMESTAMP,
        next_run TIMESTAMP,
        total_runs INTEGER DEFAULT 0,
        total_emails_processed INTEGER DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_schedules_user_active ON schedules(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run) WHERE is_active = true;
    `);
    
    console.log('✅ Schedules table created!');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_logs (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        executed_at TIMESTAMP DEFAULT NOW(),
        emails_processed INTEGER DEFAULT 0,
        action_taken VARCHAR(20),
        status VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
        error_message TEXT,
        execution_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_schedule_logs_schedule ON schedule_logs(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_logs_user ON schedule_logs(user_id);
    `);
    
    console.log('✅ Schedule logs table created!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

createSchedulesTable()
  .then(() => {
    console.log('✅ Database setup complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  });