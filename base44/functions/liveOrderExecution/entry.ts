import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { OKX_URL, decrypt, buildOkxHeaders } from '../../shared/okxExchange.ts';

/**
 * liveOrderExecution — Phase 1 (testnet only).
 *
 * Places a real order on OKX using stored, encrypted credentials, then
 * reconciles the fill state and persists it on the Trade entity.
 *
 * SAFETY (non-negotiable):
 *  - is_testnet is read from the stored ExchangeConnection record, NEVER
 *    from the request body. A client cannot flip demo → live.
 *  - Phase 1 guard: refuses live (is_testnet=false) connections. Only OKX
 *    demo trading is allowed until Phase 2 is explicitly enabled.
 *  - Kill switch: if AutoTradingSettings.kill_switch_enabled is true, the
 *    function refuses regardless of who calls it or where the call originates.
 *  - Ownership: the connection must belong to the calling user.
 *
 * MAPPING (internal → OKX):
 *   asset_symbol "BTC/USDT" → instId "BTC-USDT"
 *   side "buy"/"sell"       → OKX side "buy"/"sell"
 *   order_type "market"    → ordType "market"
 *   order_type "limit"     → ordType "limit" (+ px)
 *   tdMode "cash" (spot)
 *   sz = quantity (string)
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { connection_id, asset_symbol, side, order_type, quantity, price } = body;

    // --- Validate input ---
    if (!connection_id || !asset_symbol || !side || !order_type || !quantity) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (side !== 'buy' && side !== 'sell') {
      return Response.json({ success: false, error: 'side must be buy or sell' }, { status: 400 });
    }
    if (order_type !== 'market' && order_type !== 'limit') {
      return Response.json({ success: false, error: 'order_type must be market or limit' }, { status: 400 });
    }
    if (order_type === 'limit' && !price) {
      return Response.json({ success: false, error: 'limit orders require a price' }, { status: 400 });
    }

    // --- Load connection (ownership check — never trust the id alone) ---
    const connections = await base44.asServiceRole.entities.ExchangeConnection.filter({
      id: connection_id,
      created_by: user.email,
    });
    const connection = connections?.[0];
    if (!connection) {
      return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }
    if (connection.exchange_name !== 'okx') {
      return Response.json({ success: false, error: 'Only OKX is supported' }, { status: 400 });
    }

    // --- Phase 1 guard: testnet only. Live is blocked until Phase 2. ---
    if (!connection.is_testnet) {
      return Response.json({
        success: false,
        error: 'Live trading is not yet enabled. Phase 1 is testnet (demo) only.',
      }, { status: 403 });
    }

    // --- Kill switch — hard block regardless of caller ---
    const settingsList = await base44.asServiceRole.entities.AutoTradingSettings.filter({
      created_by: user.email,
    });
    const settings = settingsList?.[0];
    if (settings?.kill_switch_enabled) {
      return Response.json({
        success: false,
        error: 'Kill switch is active. All trading is halted.',
      }, { status: 403 });
    }

    // --- Decrypt credentials ---
    const apiKey = await decrypt(connection.encrypted_api_key);
    const apiSecret = await decrypt(connection.encrypted_api_secret);
    const apiPassphrase = connection.encrypted_api_passphrase
      ? await decrypt(connection.encrypted_api_passphrase)
      : '';

    // --- Map internal payload to OKX order params ---
    const instId = asset_symbol.replace('/', '-'); // "BTC/USDT" → "BTC-USDT"
    const orderBody = JSON.stringify({
      instId,
      tdMode: 'cash',
      side,
      ordType: order_type,
      sz: String(quantity),
      ...(order_type === 'limit' ? { px: String(price) } : {}),
    });

    const requestPath = '/api/v5/trade/order';
    const headers = await buildOkxHeaders(
      apiKey, apiSecret, apiPassphrase, 'POST', requestPath, orderBody, connection.is_testnet
    );

    // --- Place the order on OKX ---
    const res = await fetch(`${OKX_URL}${requestPath}`, {
      method: 'POST',
      headers,
      body: orderBody,
    });
    const data = await res.json();

    if (data.code !== '0') {
      // OKX rejected the order — surface the error, no silent retry.
      return Response.json({
        success: false,
        error: `OKX rejected the order (${data.code}): ${data.msg || 'Unknown error'}`,
      }, { status: 400 });
    }

    const ordId = data.data?.[0]?.ordId;
    if (!ordId) {
      return Response.json({
        success: false,
        error: 'OKX accepted but returned no order ID',
      }, { status: 500 });
    }

    // --- Create Trade entity (pending) ---
    const trade = await base44.asServiceRole.entities.Trade.create({
      asset_symbol,
      trade_type: side,
      quantity,
      price: price || 0,
      total_value: price ? price * quantity : 0,
      exchange: 'okx',
      status: 'pending',
      owner_email: user.email,
    });

    // --- Fill reconciliation: poll GET /api/v5/trade/order once ---
    const fill = await reconcileOrder(
      apiKey, apiSecret, apiPassphrase, instId, ordId, connection.is_testnet
    );

    // --- Update Trade entity with fill state ---
    if (fill.state === 'filled') {
      const fillPrice = parseFloat(fill.avgPx) || price || 0;
      await base44.asServiceRole.entities.Trade.update(trade.id, {
        status: 'completed',
        price: fillPrice,
        total_value: fillPrice * quantity,
      });
    } else if (fill.state === 'canceled') {
      await base44.asServiceRole.entities.Trade.update(trade.id, {
        status: 'cancelled',
      });
    }
    // 'partially_filled', 'live', 'unknown' stay pending — Phase 2 will poll.

    return Response.json({
      success: true,
      order_id: ordId,
      trade_id: trade.id,
      state: fill.state,
      avg_fill_price: fill.avgPx ? parseFloat(fill.avgPx) : null,
      fill_quantity: fill.fillSz ? parseFloat(fill.fillSz) : null,
      is_testnet: connection.is_testnet,
    });
  } catch (error) {
    console.error('liveOrderExecution error:', error);
    // Never echo the error body verbatim — it can contain signed query strings
    // or credential material an attacker should not see.
    return Response.json({ success: false, error: 'Order execution failed' }, { status: 500 });
  }
}

/**
 * Poll OKX for the current state of an order.
 * GET /api/v5/trade/order?instId=...&ordId=...
 *
 * Returns the raw state string OKX reports: filled, partially_filled,
 * canceled, live, etc.
 */
async function reconcileOrder(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  instId: string,
  ordId: string,
  isTestnet: boolean
): Promise<{ state: string; avgPx: string | null; fillSz: string | null }> {
  const requestPath = `/api/v5/trade/order?instId=${instId}&ordId=${ordId}`;
  const headers = await buildOkxHeaders(
    apiKey, apiSecret, passphrase, 'GET', requestPath, '', isTestnet
  );

  const res = await fetch(`${OKX_URL}${requestPath}`, { headers });
  const data = await res.json();

  if (data.code !== '0' || !data.data?.[0]) {
    return { state: 'unknown', avgPx: null, fillSz: null };
  }

  const order = data.data[0];
  return {
    state: order.state || 'unknown',
    avgPx: order.avgPx || null,
    fillSz: order.fillSz || null,
  };
}