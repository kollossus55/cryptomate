import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

/**
 * Exchange credential handling — server-side only.
 *
 * What this replaces (src/pages/ExchangeSettings.jsx:83):
 *
 *   const encodedKey = btoa(newConnection.api_key);
 *   const encodedSecret = btoa(newConnection.api_secret);
 *
 * Base64 is an encoding, not encryption — atob() reverses it in one call. The
 * secret was stored fully recoverable in the ExchangeConnection entity, while
 * the UI told the user it was "encrypted with AES-256". RLS was the only thing
 * actually protecting it, so one misconfiguration or one admin-role query
 * would have exposed every user's live exchange credentials in plaintext.
 *
 * This function:
 *   - takes credentials over an authenticated request and never returns them
 *   - VALIDATES them against the exchange with a real signed call
 *   - encrypts with AES-GCM using a key held in the server environment
 *   - stores only ciphertext plus non-sensitive metadata
 *
 * OKX note: OKX does not expose API key permissions (including withdrawal)
 * through its API, so unlike Binance we cannot programmatically reject keys
 * with withdrawal rights. The UI warns the user; the user must ensure this
 * when creating the key on OKX's website.
 *
 * SETUP REQUIRED: set EXCHANGE_ENCRYPTION_KEY in your Base44 environment to a
 * base64-encoded 32 random bytes. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Losing this key means every stored credential becomes unreadable, which is
 * the correct behaviour — it is not recoverable by design.
 */

import {
  OKX_URL,
  encrypt,
  decrypt,
  signOkxRequest,
} from '../../shared/okxExchange.ts';
import {
  KRAKEN_URL,
  buildKrakenBody,
  buildKrakenHeaders,
  isKrakenLockedOut,
  getKrakenLockoutRemainingMs,
  recordKrakenLockout,
  isKrakenLockoutError,
} from '../../shared/krakenExchange.ts';

/**
 * Validate an OKX key by calling a signed, authenticated endpoint.
 *
 * OKX uses three credentials: API key, secret, and passphrase.
 * Demo trading (testnet) is selected via the x-simulated-trading: 1 header.
 */
async function validateOkxKey(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  isTestnet: boolean
) {
  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = '/api/v5/account/balance';
  const body = '';
  const sign = await signOkxRequest(timestamp, method, requestPath, body, apiSecret);

  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
  };

  if (isTestnet) {
    headers['x-simulated-trading'] = '1';
  }

  const res = await fetch(`${OKX_URL}${requestPath}`, { headers });

  if (!res.ok) {
    const resBody = await res.text();
    return { valid: false, error: `Exchange rejected the key (${res.status}): ${resBody.slice(0, 200)}` };
  }

  const data = await res.json();

  // OKX returns code "0" on success; any other code is an error.
  if (data.code !== '0') {
    return { valid: false, error: `OKX error (${data.code}): ${data.msg || 'Unknown error'}` };
  }

  // OKX does not expose withdrawal permission via API. We can only confirm
  // the key is valid and can read. Trade permission is implied if the key
  // was created with it, but we cannot verify it here.
  const permissions = ['read'];
  if (data.data?.[0]?.canTrade) {
    permissions.push('trade');
  }

  const balanceCount = (data.data?.[0]?.details || []).filter(
    (d: any) => parseFloat(d.cashBal) > 0
  ).length;

  return {
    valid: true,
    permissions,
    balanceCount,
  };
}

/**
 * Validate a Kraken key by calling the read-only Balance endpoint.
 *
 * Kraken uses two credentials: API key and secret (no passphrase).
 * Kraken spot has no testnet/sandbox — all calls hit the live API.
 */
async function validateKrakenKey(apiKey: string, apiSecret: string) {
  if (isKrakenLockedOut()) {
    const secs = Math.ceil(getKrakenLockoutRemainingMs() / 1000);
    return { valid: false, error: `Kraken is rate-limiting this API key. Please wait ~${secs}s before retrying.` };
  }

  const urlPath = '/0/private/Balance';
  const postData = buildKrakenBody({});
  const headers = await buildKrakenHeaders(apiKey, apiSecret, urlPath, postData);

  const res = await fetch(`${KRAKEN_URL}${urlPath}`, {
    method: 'POST',
    headers,
    body: postData,
  });

  if (!res.ok) {
    return { valid: false, error: `Kraken rejected the key (${res.status})` };
  }

  const data = await res.json();

  // Kraken returns { error: [...], result: {...} }
  if (data.error && data.error.length > 0) {
    if (isKrakenLockoutError(data.error)) {
      recordKrakenLockout();
      const secs = Math.ceil(getKrakenLockoutRemainingMs() / 1000);
      return { valid: false, error: `Kraken is rate-limiting this API key. Please wait ~${secs}s before retrying.` };
    }
    return { valid: false, error: `Kraken error: ${data.error.join(', ')}` };
  }

  // Kraken does not expose granular key permissions via the Balance endpoint.
  // We can only confirm the key is valid and can read. Trade permission is
  // implied if the key was created with it, but cannot be verified here.
  const permissions = ['read'];
  const balanceCount = data.result ? Object.keys(data.result).length : 0;

  return { valid: true, permissions, balanceCount };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case 'store':
        return await handleStore(base44, user, params);
      case 'test':
        return await handleTest(base44, user, params);
      case 'delete':
        return await handleDelete(base44, user, params);
      case 'fetchBalances':
        return await handleFetchBalances(base44, user, params);
      default:
        return Response.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('exchangeCredentials error:', error);
    // Never echo the error body back verbatim — it can contain the signed
    // query string, which includes material an attacker should not see.
    return Response.json({ success: false, error: 'Credential operation failed' }, { status: 500 });
  }
});

/**
 * Load a connection by id and verify the caller is authorized to use it.
 *
 * asServiceRole bypasses RLS, so we fetch by id and enforce ownership in code.
 * Connections created by handleStore historically went through asServiceRole,
 * which stamps the *service role* as created_by_id — not the calling user. So a
 * strict created_by_id === user.id check fails for those records. We accept
 * either a direct ownership match (for connections created with the user
 * client) or an admin caller (consistent with the admin RLS read rule that
 * already lets admins see every connection).
 */
async function loadOwnedConnection(base44: any, user: any, connection_id: string) {
  const connections = await base44.asServiceRole.entities.ExchangeConnection.filter({
    id: connection_id,
  });
  const connection = connections?.[0];
  if (!connection) return null;
  if (connection.created_by_id === user.id || user.role === 'admin') return connection;
  return null;
}

async function handleStore(base44: any, user: any, params: any) {
  const { exchange_name, api_key, api_secret, api_passphrase, is_testnet = true } = params;

  if (!exchange_name || !api_key || !api_secret) {
    return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  // 1. Validate against the exchange BEFORE storing anything.
  let validation;
  if (exchange_name === 'okx') {
    if (!api_passphrase) {
      return Response.json({
        success: false,
        error: 'OKX requires an API passphrase.',
      }, { status: 400 });
    }
    validation = await validateOkxKey(api_key, api_secret, api_passphrase, is_testnet);
  } else if (exchange_name === 'kraken') {
    validation = await validateKrakenKey(api_key, api_secret);
  } else {
    return Response.json({
      success: false,
      error: `Validation for ${exchange_name} is not implemented. ` +
             `Refusing to store an unvalidated credential.`,
    }, { status: 400 });
  }

  if (!validation.valid) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }

  // 2. Encrypt and store. Only the ciphertext and a display fingerprint go in.
  const encryptedKey = await encrypt(api_key);
  const encryptedSecret = await encrypt(api_secret);
  const encryptedPassphrase = api_passphrase ? await encrypt(api_passphrase) : null;

  // Create with the user client (not asServiceRole) so the platform stamps
  // created_by_id with the calling user's id — not the service role. This is
  // what makes the ownership check in loadOwnedConnection work for non-admins.
  const record = await base44.entities.ExchangeConnection.create({
    exchange_name,
    // Deliberately NOT the plaintext key. Enough to tell two keys apart in the
    // UI, not enough to reconstruct one.
    api_key_fingerprint: `${api_key.slice(0, 4)}...${api_key.slice(-4)}`,
    encrypted_api_key: encryptedKey,
    encrypted_api_secret: encryptedSecret,
    encrypted_api_passphrase: encryptedPassphrase,
    is_testnet,
    is_active: true,
    connection_status: 'connected',
    permissions: validation.permissions,
    trading_mode: 'simulated',
    last_sync: new Date().toISOString(),
  });

  return Response.json({
    success: true,
    connection: {
      id: record.id,
      exchange_name,
      api_key_fingerprint: record.api_key_fingerprint,
      permissions: validation.permissions,
      is_testnet,
      connection_status: 'connected',
    },
  });
}

async function handleTest(base44: any, user: any, params: any) {
  const { connection_id } = params;

  const connection = await loadOwnedConnection(base44, user, connection_id);
  if (!connection) {
    return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
  }

  const apiKey = await decrypt(connection.encrypted_api_key);
  const apiSecret = await decrypt(connection.encrypted_api_secret);
  const apiPassphrase = connection.encrypted_api_passphrase
    ? await decrypt(connection.encrypted_api_passphrase)
    : '';

  let validation;
  if (connection.exchange_name === 'okx') {
    validation = await validateOkxKey(apiKey, apiSecret, apiPassphrase, connection.is_testnet);
  } else if (connection.exchange_name === 'kraken') {
    validation = await validateKrakenKey(apiKey, apiSecret);
  } else {
    validation = { valid: false, error: `Validation for ${connection.exchange_name} is not implemented.` };
  }

  await base44.asServiceRole.entities.ExchangeConnection.update(connection.id, {
    connection_status: validation.valid ? 'connected' : 'error',
    error_message: validation.valid ? null : validation.error,
    permissions: validation.valid ? validation.permissions : connection.permissions,
    last_sync: new Date().toISOString(),
  });

  // Secrets never cross this boundary.
  return Response.json({
    success: validation.valid,
    status: validation.valid ? 'connected' : 'error',
    permissions: validation.permissions ?? [],
    balanceCount: validation.balanceCount ?? null,
    error: validation.valid ? null : validation.error,
  });
}

async function handleDelete(base44: any, user: any, params: any) {
  const { connection_id } = params;
  const connection = await loadOwnedConnection(base44, user, connection_id);
  if (!connection) {
    return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
  }
  await base44.asServiceRole.entities.ExchangeConnection.delete(connection_id);
  return Response.json({ success: true });
}

/**
 * Fetch the real balances held on the connected exchange.
 *
 * Used by the Trading page to show the user's actual exchange holdings
 * alongside the paper-trading portfolio. Returns an array of
 * { asset, amount } for assets with a non-zero balance.
 */
async function handleFetchBalances(base44: any, user: any, params: any) {
  const { connection_id } = params;

  const connection = await loadOwnedConnection(base44, user, connection_id);
  if (!connection) {
    return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
  }

  const apiKey = await decrypt(connection.encrypted_api_key);
  const apiSecret = await decrypt(connection.encrypted_api_secret);

  if (connection.exchange_name === 'kraken') {
    if (isKrakenLockedOut()) {
      const secs = Math.ceil(getKrakenLockoutRemainingMs() / 1000);
      return Response.json({
        success: false,
        error: `Kraken is rate-limiting this API key. Please wait ~${secs}s before retrying.`,
        rate_limited: true,
      }, { status: 429 });
    }

    const urlPath = '/0/private/Balance';
    const postData = buildKrakenBody({});
    const headers = await buildKrakenHeaders(apiKey, apiSecret, urlPath, postData);

    const res = await fetch(`${KRAKEN_URL}${urlPath}`, { method: 'POST', headers, body: postData });
    if (!res.ok) {
      return Response.json({ success: false, error: `Kraken error (${res.status})` }, { status: 400 });
    }
    const data = await res.json();
    if (data.error && data.error.length > 0) {
      if (isKrakenLockoutError(data.error)) {
        recordKrakenLockout();
        const secs = Math.ceil(getKrakenLockoutRemainingMs() / 1000);
        return Response.json({
          success: false,
          error: `Kraken is rate-limiting this API key. Please wait ~${secs}s before retrying.`,
          rate_limited: true,
        }, { status: 429 });
      }
      return Response.json({ success: false, error: `Kraken: ${data.error.join(', ')}` }, { status: 400 });
    }

    const balances = Object.entries(data.result || {})
      .map(([asset, amount]: [string, any]) => ({
        asset: normalizeKrakenAsset(asset),
        amount: parseFloat(amount),
      }))
      .filter((b: any) => b.amount > 0);

    return Response.json({ success: true, exchange: 'kraken', balances });
  }

  if (connection.exchange_name === 'okx') {
    const apiPassphrase = connection.encrypted_api_passphrase
      ? await decrypt(connection.encrypted_api_passphrase)
      : '';
    const timestamp = new Date().toISOString();
    const method = 'GET';
    const requestPath = '/api/v5/account/balance';
    const body = '';
    const sign = await signOkxRequest(timestamp, method, requestPath, body, apiSecret);

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': apiPassphrase,
      'Content-Type': 'application/json',
    };
    if (connection.is_testnet) {
      headers['x-simulated-trading'] = '1';
    }

    const res = await fetch(`${OKX_URL}${requestPath}`, { headers });
    if (!res.ok) {
      return Response.json({ success: false, error: `OKX error (${res.status})` }, { status: 400 });
    }
    const data = await res.json();
    if (data.code !== '0') {
      return Response.json({ success: false, error: `OKX: ${data.msg || 'Unknown error'}` }, { status: 400 });
    }

    const balances: any[] = [];
    (data.data?.[0]?.details || []).forEach((d: any) => {
      const amt = parseFloat(d.cashBal);
      if (amt > 0) balances.push({ asset: d.ccy, amount: amt });
    });

    return Response.json({ success: true, exchange: 'okx', balances });
  }

  return Response.json({ success: false, error: 'Unsupported exchange' }, { status: 400 });
}

/**
 * Kraken uses X-prefixed (crypto) and Z-prefixed (fiat) asset codes.
 * Normalize them to common symbols for display.
 */
function normalizeKrakenAsset(asset: string): string {
  const map: Record<string, string> = {
    XXBT: 'BTC', XETH: 'ETH', XLTC: 'LTC', XXRP: 'XRP',
    XADA: 'ADA', XDGE: 'DOGE', XSOL: 'SOL', XDOT: 'DOT',
    USDT: 'USDT', ZUSD: 'USD', ZEUR: 'EUR', ZGBP: 'GBP',
  };
  if (map[asset]) return map[asset];
  if (asset.startsWith('X') && asset.length === 4) return asset.slice(1);
  if (asset.startsWith('Z') && asset.length === 4) return asset.slice(1);
  return asset;
}