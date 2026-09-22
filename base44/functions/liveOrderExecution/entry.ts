import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { OKX_URL, decrypt, buildOkxHeaders } from '../../shared/okxExchange.ts';
import { KRAKEN_URL, buildKrakenBody, buildKrakenHeaders } from '../../shared/krakenExchange.ts';

/**
 * liveOrderExecution — places real orders using stored, encrypted credentials,
 * then reconciles the fill state and persists it on the Trade entity.
 *
 * SAFETY (non-negotiable):
 *  - is_testnet is read from the stored ExchangeConnection record, NEVER from
 *    the request body. A client cannot flip demo → live.
 *  - OKX Phase 1 guard: refuses live (is_testnet=false) OKX connections. Only
 *    OKX demo trading is allowed until Phase 2 is explicitly enabled.
 *  - Kraken has NO testnet. All Kraken orders are live. The function requires
 *    an explicit confirm_live=true flag to place a Kraken order. A dry_run
 *    mode tests credentials via the read-only Balance endpoint without placing.
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
 *
 * MAPPING (internal → Kraken):
 *   asset_symbol "BTC/USD" → pair "BTC/USD" (Kraken's own pair format)
 *   side "buy"/"sell"      → type "buy"/"sell"
 *   order_type "market"    → ordertype "market"
 *   order_type "limit"     → ordertype "limit" (+ price)
 *   volume = quantity (string)
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { connection_id, asset_symbol, side, order_type, quantity, price, dry_run, confirm_live, user_email: callerEmail } = body;

    // When called from the auto-trading worker (service role), callerEmail is
    // the owning user's email. When called directly from the frontend, use
    // the authenticated user's own email. Only the service role (admin) may
    // act on behalf of another user.
    const actingEmail = (callerEmail && user.role === 'admin') ? callerEmail : user.email;

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
      created_by: actingEmail,
    });
    const connection = connections?.[0];
    if (!connection) {
      return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }
    if (connection.exchange_name !== 'okx' && connection.exchange_name !== 'kraken') {
      return Response.json({ success: false, error: 'Only OKX and Kraken are supported' }, { status: 400 });
    }

    // --- Phase 1 guard: OKX testnet only. Live is blocked until Phase 2. ---
    if (connection.exchange_name === 'okx' && !connection.is_testnet) {
      return Response.json({
        success: false,
        error: 'Live trading is not yet enabled. Phase 1 is testnet (demo) only.',
      }, { status: 403 });
    }

    // --- Kill switch — hard block regardless of caller ---
    const settingsList = await base44.asServiceRole.entities.AutoTradingSettings.filter({
      created_by: actingEmail,
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

    // --- Dispatch by exchange ---
    if (connection.exchange_name === 'kraken') {
      return await executeKrakenOrder(base44, user, {
        apiKey, apiSecret, asset_symbol, side, order_type, quantity, price, dry_run, confirm_live,
      });
    }

    return await executeOkxOrder(base44, user, {
      apiKey, apiSecret, apiPassphrase, asset_symbol, side, order_type, quantity, price, isTestnet: connection.is_testnet,
    });
  } catch (error) {
    console.error('liveOrderExecution error:', error);
    // Never echo the error body verbatim — it can contain signed query strings
    // or credential material an attacker should not see.
    return Response.json({ success: false, error: 'Order execution failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// OKX order path (Phase 1: testnet only)
// ---------------------------------------------------------------------------

async function executeOkxOrder(base44: any, user: any, params: any): Promise<Response> {
  const { apiKey, apiSecret, apiPassphrase, asset_symbol, side, order_type, quantity, price, isTestnet } = params;

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
    apiKey, apiSecret, apiPassphrase, 'POST', requestPath, orderBody, isTestnet
  );

  const res = await fetch(`${OKX_URL}${requestPath}`, { method: 'POST', headers, body: orderBody });
  const data = await res.json();

  if (data.code !== '0') {
    return Response.json({
      success: false,
      error: `OKX rejected the order (${data.code}): ${data.msg || 'Unknown error'}`,
    }, { status: 400 });
  }

  const ordId = data.data?.[0]?.ordId;
  if (!ordId) {
    return Response.json({ success: false, error: 'OKX accepted but returned no order ID' }, { status: 500 });
  }

  const trade = await base44.asServiceRole.entities.Trade.create({
    asset_symbol, trade_type: side, quantity,
    price: price || 0, total_value: price ? price * quantity : 0,
    exchange: 'okx', status: 'pending', owner_email: actingEmail,
  });

  const fill = await reconcileOkxOrder(apiKey, apiSecret, apiPassphrase, instId, ordId, isTestnet);

  if (fill.state === 'filled') {
    const fillPrice = parseFloat(fill.avgPx) || price || 0;
    await base44.asServiceRole.entities.Trade.update(trade.id, {
      status: 'completed', price: fillPrice, total_value: fillPrice * quantity,
    });
  } else if (fill.state === 'canceled') {
    await base44.asServiceRole.entities.Trade.update(trade.id, { status: 'cancelled' });
  }

  return Response.json({
    success: true, order_id: ordId, trade_id: trade.id, state: fill.state,
    avg_fill_price: fill.avgPx ? parseFloat(fill.avgPx) : null,
    fill_quantity: fill.fillSz ? parseFloat(fill.fillSz) : null,
    is_testnet: isTestnet,
  });
}

async function reconcileOkxOrder(
  apiKey: string, apiSecret: string, passphrase: string,
  instId: string, ordId: string, isTestnet: boolean
): Promise<{ state: string; avgPx: string | null; fillSz: string | null }> {
  const requestPath = `/api/v5/trade/order?instId=${instId}&ordId=${ordId}`;
  const headers = await buildOkxHeaders(apiKey, apiSecret, passphrase, 'GET', requestPath, '', isTestnet);
  const res = await fetch(`${OKX_URL}${requestPath}`, { headers });
  const data = await res.json();

  if (data.code !== '0' || !data.data?.[0]) {
    return { state: 'unknown', avgPx: null, fillSz: null };
  }

  const order = data.data[0];
  return { state: order.state || 'unknown', avgPx: order.avgPx || null, fillSz: order.fillSz || null };
}

// ---------------------------------------------------------------------------
// Kraken order path (Phase 2: live with safety layer — no testnet exists)
// ---------------------------------------------------------------------------

async function executeKrakenOrder(base44: any, user: any, params: any): Promise<Response> {
  const { apiKey, apiSecret, asset_symbol, side, order_type, quantity, price, dry_run, confirm_live } = params;

  // --- Dry run: verify credentials via read-only Balance endpoint ---
  if (dry_run) {
    const urlPath = '/0/private/Balance';
    const postData = buildKrakenBody({});
    const headers = await buildKrakenHeaders(apiKey, apiSecret, urlPath, postData);
    const res = await fetch(`${KRAKEN_URL}${urlPath}`, { method: 'POST', headers, body: postData });
    const data = await res.json();

    if (data.error && data.error.length > 0) {
      return Response.json({
        success: false,
        error: `Kraken credential test failed: ${data.error.join(', ')}`,
      }, { status: 400 });
    }

    return Response.json({
      success: true, dry_run: true,
      message: 'Credentials valid — no order was placed.',
    });
  }

  // --- Safety: require explicit confirmation for live orders ---
  if (!confirm_live) {
    return Response.json({
      success: false,
      error: 'Kraken has no testnet. Set confirm_live=true to place a live order.',
    }, { status: 403 });
  }

  // --- Map to Kraken AddOrder params ---
  const orderParams: Record<string, string> = {
    pair: asset_symbol,
    type: side,
    ordertype: order_type,
    volume: String(quantity),
  };
  if (order_type === 'limit') {
    orderParams.price = String(price);
  }

  const urlPath = '/0/private/AddOrder';
  const postData = buildKrakenBody(orderParams);
  const headers = await buildKrakenHeaders(apiKey, apiSecret, urlPath, postData);

  const res = await fetch(`${KRAKEN_URL}${urlPath}`, { method: 'POST', headers, body: postData });
  const data = await res.json();

  if (data.error && data.error.length > 0) {
    return Response.json({
      success: false,
      error: `Kraken rejected the order: ${data.error.join(', ')}`,
    }, { status: 400 });
  }

  const txid = data.result?.txid?.[0];
  if (!txid) {
    return Response.json({ success: false, error: 'Kraken accepted but returned no order ID' }, { status: 500 });
  }

  const trade = await base44.asServiceRole.entities.Trade.create({
    asset_symbol, trade_type: side, quantity,
    price: price || 0, total_value: price ? price * quantity : 0,
    exchange: 'kraken', status: 'pending', owner_email: actingEmail,
  });

  const fill = await reconcileKrakenOrder(apiKey, apiSecret, txid);

  if (fill.status === 'closed') {
    const fillPrice = parseFloat(fill.price) || price || 0;
    const fillQty = parseFloat(fill.vol_exec) || quantity;
    await base44.asServiceRole.entities.Trade.update(trade.id, {
      status: 'completed', price: fillPrice, total_value: fillPrice * fillQty,
    });
  } else if (fill.status === 'canceled' || fill.status === 'expired') {
    await base44.asServiceRole.entities.Trade.update(trade.id, { status: 'cancelled' });
  }

  return Response.json({
    success: true, order_id: txid, trade_id: trade.id, state: fill.status,
    avg_fill_price: fill.price ? parseFloat(fill.price) : null,
    fill_quantity: fill.vol_exec ? parseFloat(fill.vol_exec) : null,
    exchange: 'kraken',
  });
}

async function reconcileKrakenOrder(
  apiKey: string, apiSecret: string, txid: string
): Promise<{ status: string; price: string | null; vol_exec: string | null }> {
  const urlPath = '/0/private/QueryOrders';
  const postData = buildKrakenBody({ txid });
  const headers = await buildKrakenHeaders(apiKey, apiSecret, urlPath, postData);

  const res = await fetch(`${KRAKEN_URL}${urlPath}`, { method: 'POST', headers, body: postData });
  const data = await res.json();

  if ((data.error && data.error.length > 0) || !data.result) {
    return { status: 'unknown', price: null, vol_exec: null };
  }

  const order = data.result[txid];
  if (!order) {
    return { status: 'unknown', price: null, vol_exec: null };
  }

  return {
    status: order.status || 'unknown', // pending, open, closed, canceled, expired
    price: order.price || null,
    vol_exec: order.vol_exec || null,
  };
}