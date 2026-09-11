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

        // asServiceRole.functions.invoke does not transmit the body in this
        // runtime (platform returns "Missing parameters"). Forward the request
        // directly to the worker's HTTP endpoint, passing the same auth headers
        // so the worker's createClientFromRequest inherits service-role access.
        const apiUrl = req.headers.get('base44-api-url') || url.origin;
        const workerUrl = `${apiUrl}/functions/autoTradingWorker`;
        const fwdHeaders = { 'Content-Type': 'application/json' };
        for (const h of ['base44-service-authorization', 'base44-app-id', 'authorization']) {
          const v = req.headers.get(h);
          if (v) fwdHeaders[h] = v;
        }
        const workerRes = await fetch(workerUrl, {
          method: 'POST',
          headers: fwdHeaders,
          body: JSON.stringify(invokeArgs),
        });
        const result = await workerRes.json().catch(() => ({}));

        processed++;

        if (result?.success) {
          if (result.executed) {
            executed++;
            console.log(`✅ Trade executed for ${settings.created_by}: ${result.trade?.symbol} (${result.trade?.action})`);
          } else {
            console.log(`ℹ️ No trade for ${settings.created_by}: ${result.reason}`);
          }
        } else {
          console.error(`⚠️ Worker failed for ${settings.created_by}:`, result?.error || 'Unknown error');
          lastError.push({ user: settings.created_by, error: result?.error || 'Unknown error', status: workerRes.status });
          errors++;
        }
        } catch (error) {
        errors++;
        console.error(`❌ Error processing user ${settings.created_by}:`, error.message);
        lastError.push({
          user: settings.created_by,
          message: error.message,
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