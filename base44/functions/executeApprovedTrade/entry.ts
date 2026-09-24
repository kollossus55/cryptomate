import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';

/**
 * Executes or rejects a pending trade approval created by the auto-trading
 * worker in manual AI-confirmation mode.
 *
 * Self-contained: inlines a minimal price fetcher and cost model so it does
 * not need to import from the autoTradingWorker's shared directory (which
 * the bundler cannot reach across function boundaries).
 */

const OKX = 'https://www.okx.com';
const FEE_PERCENT = 0.1;      // 0.1% taker fee
const SLIPPAGE_PERCENT = 0.05; // 0.05% assumed slippage for market buys

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { approval_id, action } = body;

    if (!approval_id) {
      return Response.json({ error: 'Missing approval_id' }, { status: 400 });
    }
    if (action !== 'approve' && action !== 'reject') {
      return Response.json({ error: 'Invalid action (approve or reject)' }, { status: 400 });
    }

    let approval;
    try {
      approval = await base44.asServiceRole.entities.PendingTradeApproval.get(approval_id);
    } catch {
      return Response.json({ error: 'Approval not found' }, { status: 404 });
    }
    if (!approval) {
      return Response.json({ error: 'Approval not found' }, { status: 404 });
    }

    if (approval.owner_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (approval.status !== 'pending') {
      return Response.json({ error: `Approval already ${approval.status}` }, { status: 400 });
    }

    const now = new Date();
    if (approval.expires_at && new Date(approval.expires_at) < now) {
      await base44.asServiceRole.entities.PendingTradeApproval.update(approval.id, {
        status: 'expired',
        reviewed_at: now.toISOString(),
      });
      return Response.json({ error: 'Approval has expired' }, { status: 400 });
    }

    // ── Reject ───────────────────────────────────────────────────────────
    if (action === 'reject') {
      await base44.asServiceRole.entities.PendingTradeApproval.update(approval.id, {
        status: 'rejected',
        reviewed_at: now.toISOString(),
      });
      await notify(base44, approval.owner_email, {
        type: 'system',
        priority: 'low',
        title: `Trade rejected: ${approval.asset_symbol}`,
        message: `You rejected the pending ${approval.asset_symbol} trade (strength ${approval.signal_strength}/100).`,
      });
      return Response.json({ success: true, status: 'rejected' });
    }

    // ── Approve & execute ────────────────────────────────────────────────
    const user_email = approval.owner_email;

    const portfolios = await base44.asServiceRole.entities.Portfolio.filter({ created_by: user_email });
    const portfolio = portfolios?.[0];
    if (!portfolio) {
      await base44.asServiceRole.entities.PendingTradeApproval.update(approval.id, {
        status: 'failed',
        reviewed_at: now.toISOString(),
        execution_result: { error: 'Portfolio not found' },
      });
      return Response.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    // Fetch current price from OKX
    let currentPrice = approval.entry_price;
    try {
      const instId = approval.asset_symbol.replace('USDT', '-USDT');
      const resp = await fetch(`${OKX}/api/v5/market/ticker?instId=${instId}`, { signal: AbortSignal.timeout(8000) });
      const data = await resp.json();
      if (data.code === '0' && data.data?.[0]?.last) {
        const price = parseFloat(data.data[0].last);
        if (Number.isFinite(price) && price > 0) currentPrice = price;
      }
    } catch (e) {
      console.warn(`Price fetch failed for ${approval.asset_symbol}: ${e.message}`);
    }

    const quoteAmount = approval.position_size_usdt || 0;
    if (quoteAmount < 10) {
      await base44.asServiceRole.entities.PendingTradeApproval.update(approval.id, {
        status: 'failed',
        reviewed_at: now.toISOString(),
        execution_result: { error: 'Position size too small' },
      });
      return Response.json({ error: 'Position size too small' }, { status: 400 });
    }

    // Check available balance
    if ((portfolio.available_balance || 0) < quoteAmount) {
      await base44.asServiceRole.entities.PendingTradeApproval.update(approval.id, {
        status: 'failed',
        reviewed_at: now.toISOString(),
        execution_result: { error: 'Insufficient available balance' },
      });
      return Response.json({ error: 'Insufficient available balance' }, { status: 400 });
    }

    // Simple cost model: fee + slippage
    let fillPrice = currentPrice * (1 + SLIPPAGE_PERCENT / 100);
    const fee = quoteAmount * (FEE_PERCENT / 100);
    let quantity = (quoteAmount - fee) / fillPrice;

    // Check live trading config
    const settings = await base44.asServiceRole.entities.AutoTradingSettings.filter({ created_by: user_email });
    const s = settings?.[0];
    let liveTrading = { enabled: false };
    if (s?.live_trading_enabled && s?.exchange_connection_id) {
      const conns = await base44.asServiceRole.entities.ExchangeConnection.filter({ id: s.exchange_connection_id });
      const conn = conns?.[0];
      if (conn?.is_active && conn?.connection_status === 'connected' && conn?.trading_mode === 'ready_for_live') {
        if (s.live_trading_requested_at) {
          const cooldownEnd = new Date(new Date(s.live_trading_requested_at).getTime() + 24 * 60 * 60 * 1000);
          if (new Date() >= cooldownEnd) {
            liveTrading = { enabled: true, connection_id: conn.id, exchange: conn.exchange_name };
          }
        }
      }
    }

    // Execute live order if configured
    if (liveTrading.enabled) {
      try {
        const liveResult = await base44.asServiceRole.functions.invoke('liveOrderExecution', {
          connection_id: liveTrading.connection_id,
          asset_symbol: approval.asset_symbol,
          side: 'buy',
          order_type: 'market',
          quantity,
          confirm_live: true,
          user_email,
        });
        const liveData = liveResult?.data ?? liveResult;
        if (liveData?.success && liveData?.avg_fill_price) {
          fillPrice = liveData.avg_fill_price;
        }
      } catch (e) {
        console.warn(`Live order failed for ${approval.asset_symbol}: ${e.message}`);
      }
    }

    // Update portfolio: deduct balance, add position
    const positions = Array.isArray(portfolio.positions) ? [...portfolio.positions] : [];
    const existingIdx = positions.findIndex(
      (p) => p.asset_symbol === approval.asset_symbol
    );

    if (existingIdx >= 0) {
      // Average into existing position
      const existing = positions[existingIdx];
      const oldNotional = existing.quantity * existing.avg_entry_price;
      const newNotional = quantity * fillPrice;
      existing.quantity += quantity;
      existing.avg_entry_price = (oldNotional + newNotional) / existing.quantity;
      existing.current_value = existing.quantity * fillPrice;
      existing.profit_loss = existing.current_value - (existing.quantity * existing.avg_entry_price);
    } else {
      positions.push({
        asset_symbol: approval.asset_symbol,
        quantity,
        avg_entry_price: fillPrice,
        current_value: quantity * fillPrice,
        profit_loss: 0,
        highest_price: fillPrice,
        dca_count: 0,
      });
    }

    const newAvailable = (portfolio.available_balance || 0) - quoteAmount;
    const newTotal = (portfolio.total_balance || 0) - fee;

    await base44.asServiceRole.entities.Portfolio.update(portfolio.id, {
      available_balance: newAvailable,
      total_balance: newTotal,
      positions,
      total_trades: (portfolio.total_trades || 0) + 1,
    });

    // Create Trade record
    const exchangeLabel = liveTrading.enabled
      ? `${liveTrading.exchange} (Live — Manual Approve)`
      : 'Paper Trading (Manual Approve)';
    await base44.asServiceRole.entities.Trade.create({
      asset_symbol: approval.asset_symbol,
      trade_type: 'buy',
      quantity,
      price: fillPrice,
      total_value: quantity * fillPrice,
      fee,
      slippage_percent: SLIPPAGE_PERCENT,
      exchange: exchangeLabel,
      status: 'completed',
      profit_loss: 0,
      ai_signal: {
        confidence: approval.signal_strength,
        reasoning: (approval.signal_reasons || []).join('; '),
        indicators: ['Manual AI Approval'],
      },
      owner_email: user_email,
      created_by: user_email,
    });

    // Update the approval
    await base44.asServiceRole.entities.PendingTradeApproval.update(approval.id, {
      status: 'executed',
      reviewed_at: now.toISOString(),
      executed_at: now.toISOString(),
      execution_result: {
        fill_price: fillPrice,
        quantity,
        fee,
        slippage_percent: SLIPPAGE_PERCENT,
        exchange: exchangeLabel,
      },
    });

    // Notify
    await notify(base44, user_email, {
      type: 'order_filled',
      priority: 'medium',
      title: `BUY ${approval.asset_symbol} (Manual Approve)`,
      message: `${quantity.toFixed(6)} @ $${fillPrice.toFixed(6)} (fee $${fee.toFixed(2)}). ${(approval.signal_reasons || []).slice(0, 2).join('; ')}`,
    });

    return Response.json({
      success: true,
      status: 'executed',
      fill_price: fillPrice,
      quantity,
      fee,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function notify(base44, user_email, { type, priority, title, message }) {
  try {
    await base44.asServiceRole.entities.Notification.create({
      notification_type: type,
      priority,
      title,
      message,
      created_by: user_email,
    });
  } catch (err) {
    console.warn(`Notification failed: ${err.message}`);
  }
}