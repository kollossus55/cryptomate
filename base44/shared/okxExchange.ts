/**
 * Shared OKX exchange utilities — AES-GCM credential encryption and OKX
 * request signing.
 *
 * Used by exchangeCredentials (credential storage/validation) and
 * liveOrderExecution (real order placement). Extracted here so the crypto
 * + signing logic is never duplicated across functions.
 *
 * SETUP REQUIRED: EXCHANGE_ENCRYPTION_KEY must be set in the Base44
 * environment to a base64-encoded 32 random bytes.
 */

export const OKX_URL = 'https://www.okx.com';

// ---------------------------------------------------------------------------
// AES-GCM encryption (credentials at rest)
// ---------------------------------------------------------------------------

export async function getEncryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('EXCHANGE_ENCRYPTION_KEY');
  if (!raw) {
    throw new Error(
      'EXCHANGE_ENCRYPTION_KEY is not set. Refusing to store or read ' +
      'credentials without encryption.'
    );
  }
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error('EXCHANGE_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext: string): Promise<string> {
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

export async function decrypt(payload: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ---------------------------------------------------------------------------
// OKX request signing
// ---------------------------------------------------------------------------

/**
 * OKX signature = base64(HMAC-SHA256(timestamp + method + requestPath + body))
 * timestamp must be ISO 8601 format.
 */
export async function signOkxRequest(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secret: string
): Promise<string> {
  const prehash = timestamp + method + requestPath + body;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(prehash));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Build the full OKX authenticated header set, including the
 * x-simulated-trading header when isTestnet is true.
 */
export async function buildOkxHeaders(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  method: string,
  requestPath: string,
  body: string,
  isTestnet: boolean
): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
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
  return headers;
}