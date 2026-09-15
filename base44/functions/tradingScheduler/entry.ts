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
    let debugCaller = null;
    if (!hasServiceAuth) {
      try {
        const caller = await base44.auth.me();
        debugCaller = { email: caller?.email, role: caller?.role };
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

        // Use the SDK's function invoke — the documented way to call one
        // backend function from another. The service-role context from
        // createClientFromRequest is passed through automatically, so the
        // worker's asServiceRole calls succeed without header forwarding.
        let result;
        try {
          const res = await base44.asServiceRole.functions.invoke('autoTradingWorker', invokeArgs);
          result = res.data;
          // Debug: return diagnostic info on first iteration
          if (processed === 0) {
            result._debug = { reqUrl: req.url, origin: new URL(req.url).origin, hasServiceAuth, debugCaller };
          }
        } catch (invokeErr) {
          const status = invokeErr.response?.status ?? 500;
          const body = invokeErr.response?.data ?? {};
          console.error(`⚠️ Worker failed for ${settings.created_by}:`, body?.error || invokeErr.message, 'status:', status, 'body:', JSON.stringify(body));
          lastError.push({ user: settings.created_by, error: body?.error || invokeErr.message, status, debug: { reqUrl: req.url, origin: new URL(req.url).origin, hasServiceAuth, debugCaller, errBody: body } });
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