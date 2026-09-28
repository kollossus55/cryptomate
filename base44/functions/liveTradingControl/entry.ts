import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

/**
 * Server-side authority for the live-trading arming sequence.
 *
 * The 24-hour cooldown between requesting live trading and enabling real
 * orders is a primary financial-safety control. Previously the UI wrote the
 * entity fields (live_trading_enabled, live_trading_requested_at,
 * ExchangeConnection.trading_mode) directly, and the server-side trading
 * engines trusted those fields — but skipped the cooldown check entirely
 * when live_trading_requested_at was null, so a direct entity-API write of
 * live_trading_enabled=true bypassed the cooldown.
 *
 * This function is now the only legitimate writer of those fields. It:
 *  - validates an active, connected exchange connection before arming,
 *  - stamps live_trading_requested_at itself (request),
 *  - refuses to set live_trading_enabled until a server-verified 24h
 *    cooldown has elapsed (enable),
 *  - is the only writer of trading_mode = 'ready_for_live'.
 * The server-side consumers (autoTradingWorker, executeApprovedTrade) treat
 * the cooldown as mandatory and fail closed when the timestamp is missing,
 * so a direct entity write alone can no longer activate live trading.
 */

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const VALID_ACTIONS = new Set(['request', 'enable', 'disable', 'cancel']);

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action } = body;
    if (!VALID_ACTIONS.has(action)) {
      return Response.json({ error: 'Invalid action (request, enable, disable, cancel)' }, { status: 400 });
    }

    const user_email = user.email;

    // Load the caller's settings (may not exist yet on first request).
    const existing = await base44.asServiceRole.entities.AutoTradingSettings.filter({ created_by: user_email });
    const settings = existing?.[0];

    // Load the caller's active connected exchange connection.
    const connections = await base44.asServiceRole.entities.ExchangeConnection.filter({ created_by: user_email });
    const activeConnection = connections?.find((c) => c.is_active && c.connection_status === 'connected');

    // ── request ──────────────────────────────────────────────────────────
    // Arm: mark the connection ready_for_live and stamp the cooldown start.
    if (action === 'request') {
      if (!activeConnection) {
        return Response.json({ error: 'No active connected exchange connection' }, { status: 400 });
      }
      await base44.asServiceRole.entities.ExchangeConnection.update(activeConnection.id, {
        trading_mode: 'ready_for_live',
      });
      const now = new Date().toISOString();
      if (settings) {
        await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
          live_trading_requested_at: now,
          exchange_connection_id: activeConnection.id,
          live_trading_enabled: false,
        });
      } else {
        await base44.asServiceRole.entities.AutoTradingSettings.create({
          is_enabled: false,
          min_confidence: 70,
          max_position_size_percent: 10,
          live_trading_requested_at: now,
          exchange_connection_id: activeConnection.id,
          live_trading_enabled: false,
          created_by: user_email,
        });
      }
      return Response.json({ success: true, action: 'request', live_trading_requested_at: now });
    }

    // ── enable ───────────────────────────────────────────────────────────
    // Refuse unless a server-stamped request exists AND 24h have elapsed.
    if (action === 'enable') {
      if (!settings || !settings.live_trading_requested_at) {
        return Response.json({ error: 'Live trading has not been requested. Request it first and wait 24 hours.' }, { status: 400 });
      }
      const requestedAt = new Date(settings.live_trading_requested_at);
      const cooldownEnd = new Date(requestedAt.getTime() + COOLDOWN_MS);
      if (new Date() < cooldownEnd) {
        return Response.json({
          error: '24-hour cooldown has not passed yet',
          cooldown_end: cooldownEnd.toISOString(),
        }, { status: 400 });
      }
      if (!settings.exchange_connection_id) {
        return Response.json({ error: 'No exchange connection assigned' }, { status: 400 });
      }
      const conns = await base44.asServiceRole.entities.ExchangeConnection.filter({ id: settings.exchange_connection_id });
      const conn = conns?.[0];
      if (!conn || !conn.is_active || conn.connection_status !== 'connected') {
        return Response.json({ error: 'Exchange connection is not active or connected' }, { status: 400 });
      }
      if (conn.trading_mode !== 'ready_for_live') {
        return Response.json({ error: 'Exchange connection is not in ready_for_live mode' }, { status: 400 });
      }
      await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
        live_trading_enabled: true,
      });
      return Response.json({ success: true, action: 'enable' });
    }

    // ── disable ──────────────────────────────────────────────────────────
    if (action === 'disable') {
      if (settings) {
        await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
          live_trading_enabled: false,
        });
      }
      return Response.json({ success: true, action: 'disable' });
    }

    // ── cancel ────────────────────────────────────────────────────────────
    // Clear the arming state and return the connection to simulated mode.
    if (action === 'cancel') {
      if (settings) {
        await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
          live_trading_requested_at: null,
          exchange_connection_id: null,
          live_trading_enabled: false,
        });
      }
      if (activeConnection) {
        await base44.asServiceRole.entities.ExchangeConnection.update(activeConnection.id, {
          trading_mode: 'simulated',
        });
      }
      return Response.json({ success: true, action: 'cancel' });
    }

    return Response.json({ error: 'Unhandled action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}