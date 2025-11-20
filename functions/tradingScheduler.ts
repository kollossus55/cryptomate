/**
 * Trading Scheduler - Triggers Auto-Trading Worker
 * Runs on a schedule (every 1-5 minutes) to execute trading checks for all users
 * 
 * This is the entry point that gets triggered by the platform's scheduler
 */

import { base44 } from '@/api/base44Client';
import autoTradingWorker from './autoTradingWorker';

/**
 * Main scheduler function - finds all users with auto-trading enabled
 * and triggers the worker for each user
 */
export default async function tradingScheduler() {
  console.log('[Trading Scheduler] Starting scheduled auto-trading check...');
  
  try {
    // Fetch all users with auto-trading enabled
    const allSettings = await base44.entities.AutoTradingSettings.filter({
      is_enabled: true
    });
    
    if (!allSettings || allSettings.length === 0) {
      console.log('[Trading Scheduler] No active auto-trading users found');
      return {
        success: true,
        message: 'No active auto-trading users',
        timestamp: new Date().toISOString()
      };
    }
    
    console.log(`[Trading Scheduler] Found ${allSettings.length} active auto-trading users`);
    
    const results = [];
    
    // Process each user sequentially to avoid overwhelming the system
    for (const settings of allSettings) {
      const user_email = settings.created_by;
      
      try {
        console.log(`[Trading Scheduler] Processing user: ${user_email}`);
        
        // Check if it's time to reset daily counters
        const now = new Date();
        const lastTradeDate = settings.last_trade_date ? new Date(settings.last_trade_date) : null;
        
        if (!lastTradeDate || lastTradeDate.getDate() !== now.getDate()) {
          // Reset daily counters
          await base44.entities.AutoTradingSettings.update(settings.id, {
            trades_today: 0,
            daily_loss: 0,
            assets_traded_today: []
          });
          console.log(`[Trading Scheduler] Reset daily counters for ${user_email}`);
        }
        
        // Execute auto-trading worker for this user
        const result = await autoTradingWorker({ user_email });
        results.push({
          user_email,
          ...result
        });
        
        // Small delay between users to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[Trading Scheduler] Error processing ${user_email}:`, error);
        results.push({
          user_email,
          success: false,
          error: error.message
        });
      }
    }
    
    // Calculate summary
    const successful = results.filter(r => r.success).length;
    const executed = results.filter(r => r.executed).length;
    
    console.log(`[Trading Scheduler] Completed: ${successful}/${results.length} successful, ${executed} trades executed`);
    
    return {
      success: true,
      processed: results.length,
      successful,
      executed,
      results,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('[Trading Scheduler] Scheduler error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}