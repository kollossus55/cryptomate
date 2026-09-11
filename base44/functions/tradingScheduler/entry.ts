import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

/**
 * Trading Scheduler - Runs every 2 minutes
 * Processes auto-trading for all users with enabled settings
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Health check endpoint
    const url = new URL(req.url);
    if (url.searchParams.get('check_only') === 'true') {
      return Response.json({ 
        status: 'healthy',
        backend_trading: true,
        message: '24/7 server-side trading active'
      });
    }

    console.log('🤖 Trading Scheduler: Starting auto-trading check for all users');
    
    // Get all users with auto-trading enabled (using service role)
    const autoTradingSettings = await base44.asServiceRole.entities.AutoTradingSettings.list();
    // Filter out users who have explicitly selected 'browser' execution mode
    const enabledSettings = autoTradingSettings.filter(s => s.is_enabled && s.execution_mode !== 'browser');
    
    console.log(`📊 Found ${enabledSettings.length} users with server-side auto-trading enabled`);
    
    let processed = 0;
    let executed = 0;
    let errors = 0;
    const lastError = [];

    for (const settings of enabledSettings) {
      try {
        // Get user's portfolio
        const portfolios = await base44.asServiceRole.entities.Portfolio.filter({
          created_by: settings.created_by
        });
        
        if (!portfolios || portfolios.length === 0) {
          console.log(`⚠️ No portfolio found for user ${settings.created_by}`);
          continue;
        }
        
        const portfolio = portfolios[0];
        
        // Invoke auto-trading worker for this user. The worker fetches settings
        // and portfolio from the DB by ID — we only pass identifiers, never the
        // records themselves, so the worker cannot be fed crafted data.
        console.log(`⏳ Invoking worker for ${settings.created_by}...`);
        const invokeArgs = {
          settings_id: settings.id,
          user_email: settings.created_by
        };
        lastError.push({ stage: 'pre-invoke', args: invokeArgs, argsTypes: { settings_id: typeof settings.id, user_email: typeof settings.created_by } });
        const result = await base44.asServiceRole.functions.invoke('autoTradingWorker', invokeArgs);
        
        processed++;
        
        if (result.data?.success) {
          if (result.data.executed) {
            executed++;
            console.log(`✅ Trade executed for ${settings.created_by}: ${result.data.trade?.symbol} (${result.data.trade?.action})`);
          } else {
            console.log(`ℹ️ No trade for ${settings.created_by}: ${result.data.reason}`);
          }
        } else {
          console.error(`⚠️ Worker failed for ${settings.created_by}:`, result.data?.error || 'Unknown error');
          errors++;
        }
        
      } catch (error) {
        errors++;
        console.error(`❌ Error processing user ${settings.created_by}:`, error.message);
        lastError.push({
          user: settings.created_by,
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
          stack: error.stack?.split('\n').slice(0, 6),
        });
      }
    }
    
    const summary = {
      timestamp: new Date().toISOString(),
      users_checked: enabledSettings.length,
      users_processed: processed,
      trades_executed: executed,
      errors: errors
    };
    
    console.log('📊 Trading Scheduler Summary:', summary);
    
    return Response.json({
      success: true,
      summary,
      lastError
    });
    
  } catch (error) {
    console.error('❌ Trading Scheduler Error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});