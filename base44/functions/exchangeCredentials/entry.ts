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
 *   - REJECTS any key with withdrawal permission, unconditionally
 *   - encrypts with AES-GCM using a key held in the server environment
 *   - stores only ciphertext plus non-sensitive metadata
 *
 * SETUP REQUIRED: set EXCHANGE_ENCRYPTION_KEY in your Base44 environment to a
 * base64-encoded 32 random bytes. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Losing this key means every stored credential becomes unreadable, which is
 * the correct behaviour — it is not recoverable by design.
 */

const BINANCE_LIVE = 'https://api.binance.com';
const BINANCE_TESTNET = 'https://testnet.binance.vision';

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

async function getEncryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('EXCHANGE_ENCRYPTION_KEY');
  if (!raw) {
    throw new Error(
      'EXCHANGE_ENCRYPTION_KEY is not set. Refusing to store credentials ' +
      'without encryption.'
    );
  }
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error('EXCHANGE_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  // A fresh random IV per encryption. Reusing an IV with AES-GCM is
  // catastrophic — it leaks the XOR of the plaintexts.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(payload: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ---------------------------------------------------------------------------
// Real validation
// ---------------------------------------------------------------------------

async function signQuery(secret: string, query: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(query));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate a Binance key by calling a signed, authenticated endpoint.
 *
 * The old handleTestConnection() fetched a PUBLIC ticker and, if it returned
 * 200, recorded permissions as ['read', 'trade'] — which tested nothing about
 * the key. Any string would have "passed". This makes a real signed call.
 */
async function validateBinanceKey(apiKey: string, apiSecret: string, isTestnet: boolean) {
  const baseUrl = isTestnet ? BINANCE_TESTNET : BINANCE_LIVE;
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}&recvWindow=5000`;
  const signature = await signQuery(apiSecret, query);

  const res = await fetch(`${baseUrl}/api/v3/account?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    return { valid: false, error: `Exchange rejected the key (${res.status}): ${body.slice(0, 200)}` };
  }

  const account = await res.json();
  const permissions: string[] = [];
  if (account.canTrade) permissions.push('trade');
  if (account.canWithdraw) permissions.push('withdraw');
  if (account.canDeposit) permissions.push('deposit');
  permissions.push('read');

  return {
    valid: true,
    permissions,
    accountType: account.accountType,
    // Non-sensitive: which assets hold a non-zero balance, for display.
    balanceCount: (account.balances || []).filter(
      (b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    ).length,
  };
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

async function handleStore(base44: any, user: any, params: any) {
  const { exchange_name, api_key, api_secret, is_testnet = true } = params;

  if (!exchange_name || !api_key || !api_secret) {
    return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  // 1. Validate against the exchange BEFORE storing anything.
  let validation;
  if (exchange_name === 'binance') {
    validation = await validateBinanceKey(api_key, api_secret, is_testnet);
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

  // 2. Reject withdrawal permission, unconditionally.
  //
  // There is no legitimate reason for a trading bot to hold a key that can
  // move funds off the exchange, and a compromised one with this permission
  // is a total loss rather than a bad trade. This is not a warning the user
  // can dismiss.
  if (validation.permissions.includes('withdraw')) {
    return Response.json({
      success: false,
      error: 'This API key has WITHDRAWAL permission enabled. Trading bots must ' +
             'never hold withdrawal rights. Delete this key on the exchange, ' +
             'create a new one with only "Enable Reading" and "Enable Spot Trading", ' +
             'and restrict it to your server IP address.',
      code: 'WITHDRAW_PERMISSION_REJECTED',
    }, { status: 400 });
  }

  // 3. Encrypt and store. Only the ciphertext and a display fingerprint go in.
  const encryptedKey = await encrypt(api_key);
  const encryptedSecret = await encrypt(api_secret);

  const record = await base44.asServiceRole.entities.ExchangeConnection.create({
    exchange_name,
    // Deliberately NOT the plaintext key. Enough to tell two keys apart in the
    // UI, not enough to reconstruct one.
    api_key_fingerprint: `${api_key.slice(0, 4)}...${api_key.slice(-4)}`,
    encrypted_api_key: encryptedKey,
    encrypted_api_secret: encryptedSecret,
    is_testnet,
    is_active: true,
    connection_status: 'connected',
    permissions: validation.permissions,
    trading_mode: 'simulated',
    last_sync: new Date().toISOString(),
    created_by: user.email,
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

  const connections = await base44.asServiceRole.entities.ExchangeConnection.filter({
    id: connection_id,
    created_by: user.email, // ownership check — never trust the id alone
  });
  const connection = connections?.[0];
  if (!connection) {
    return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
  }

  const apiKey = await decrypt(connection.encrypted_api_key);
  const apiSecret = await decrypt(connection.encrypted_api_secret);

  const validation = await validateBinanceKey(apiKey, apiSecret, connection.is_testnet);

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
  const connections = await base44.asServiceRole.entities.ExchangeConnection.filter({
    id: connection_id,
    created_by: user.email,
  });
  if (!connections?.[0]) {
    return Response.json({ success: false, error: 'Connection not found' }, { status: 404 });
  }
  await base44.asServiceRole.entities.ExchangeConnection.delete(connection_id);
  return Response.json({ success: true });
}
