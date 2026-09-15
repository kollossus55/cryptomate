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

    // Auth: allow the platform scheduler (service-authorization header) or an
    // authenticated admin. Prevents unauthenticated callers from triggering the
    // trading loop or probing internal endpoints via forwarded headers.
    const hasServiceAuth = !!req.headers.get('base44-service-authorization');
    if (!hasServiceAuth) {
      try {
        const caller = await base44.auth.me();
        if (!caller || caller.role !== 'admin') {
          return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
      } catch {
        return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
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

        // Call the worker via the app's public function URL. The SDK's
        // asServiceRole.functions.invoke caches stale function versions; a
        // direct fetch to the public endpoint always runs the latest deploy.
        // Forward the service-authorization header so the worker trusts the
        // call as a platform service request.
        let result;
        try {
          const workerUrl = 'https://crypto-mate-win.base44.app/functions/autoTradingWorker';
          const workerRes = await fetch(workerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(hasServiceAuth ? { 'base44-service-authorization': req.headers.get('base44-service-authorization') } : {}),
            },
            body: JSON.stringify(invokeArgs),
          });
          result = await workerRes.json();
          if (!workerRes.ok) {
            throw { response: { status: workerRes.status, data: result } };
          }
        } catch (invokeErr) {
          const status = invokeErr.response?.status ?? 500;
          const body = invokeErr.response?.data ?? {};
          console.error(`⚠️ Worker failed for ${settings.created_by}:`, body?.error || invokeErr.message, 'status:', status);
          lastError.push({ user: settings.created_by, error: body?.error || invokeErr.message, status });
          errors++;
          processed++;
          continue;
        }

        processed++;

        if (result?.success) {
          const tradeCount = result.trades?.length ?? 0;
          if (tradeCount > 0) {
            executed += tradeCount;
            const buys = result.trades.filter(t => t.action === 'buy').length;
            const sells = result.trades.filter(t => t.action === 'sell').length;
            console.log(`✅ ${tradeCount} trade(s) for ${settings.created_by}: ${buys} buy, ${sells} sell`);
          } else if (result.halted) {
            console.log(`🛑 Halted for ${settings.created_by}: ${result.reason}`);
          } else if (result.skipped) {
            console.log(`⏭️ Skipped for ${settings.created_by}: ${result.reason}`);
          } else {
            console.log(`ℹ️ No trade for ${settings.created_by} (scanned ${result.scanned ?? 0})`);
          }
        } else {
          console.error(`⚠️ Worker failed for ${settings.created_by}:`, result?.error || 'Unknown error');
          lastError.push({ user: settings.created_by, error: result?.error || 'Unknown error', status: 500 });
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