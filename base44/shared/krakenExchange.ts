/**
 * Shared Kraken exchange utilities — Kraken HMAC-SHA512 request signing.
 *
 * Used by exchangeCredentials (credential validation) and liveOrderExecution
 * (real order placement). Extracted here so the signing logic is never
 * duplicated across functions.
 *
 * Kraken spot has NO testnet/sandbox — all API calls hit the live environment.
 * The liveOrderExecution function enforces a safety layer (kill switch,
 * ownership, explicit confirm_live flag, dry-run mode) for Kraken orders.
 *
 * Encryption (encrypt/decrypt) is shared from okxExchange.ts — the AES-GCM
 * logic is exchange-agnostic.
 *
 * SETUP REQUIRED: EXCHANGE_ENCRYPTION_KEY must be set in the Base44
 * environment (shared with okxExchange.ts).
 */

export const KRAKEN_URL = 'https://api.kraken.com';

// ---------------------------------------------------------------------------
// Kraken rate-limit lockout guard
// ---------------------------------------------------------------------------
//
// Kraken returns `EGeneral:Temporary lockout` when an API key makes too many
// private calls in a short window. The worst thing to do is retry immediately
// — every call during the lockout extends it. This module-level cooldown is
// shared across all functions in the same isolate, so once any Kraken call
// reports a lockout, subsequent calls short-circuit until the window clears.

const LOCKOUT_COOLDOWN_MS = 60_000; // Kraken lockouts typically clear in <1 min
let krakenLockoutUntil = 0;

export function isKrakenLockedOut(): boolean {
  return Date.now() < krakenLockoutUntil;
}

export function getKrakenLockoutRemainingMs(): number {
  return Math.max(0, krakenLockoutUntil - Date.now());
}

export function recordKrakenLockout(): void {
  krakenLockoutUntil = Date.now() + LOCKOUT_COOLDOWN_MS;
}

/**
 * Kraken returns `{ error: [...] }`. Check whether any error string indicates
 * a temporary rate-limit lockout.
 */
export function isKrakenLockoutError(errors: string[] | undefined): boolean {
  if (!errors || !Array.isArray(errors)) return false;
  return errors.some((e) => typeof e === 'string' && e.includes('EGeneral:Temporary lockout'));
}

// ---------------------------------------------------------------------------
// Kraken request signing
// ---------------------------------------------------------------------------

/**
 * Build the urlencoded POST body with a strictly-increasing nonce.
 *
 * Kraken requires the nonce to be a number that increases with each call for
 * a given API key. Date.now() (milliseconds) is the standard choice.
 */
export function buildKrakenBody(params: Record<string, string>): string {
  const nonce = String(Date.now());
  const searchParams = new URLSearchParams({ nonce, ...params });
  return searchParams.toString();
}

/**
 * Kraken signature:
 *   base64(HMAC-SHA512(urlPath + SHA256(nonce + urlencodedBody), base64decode(secret)))
 *
 * The nonce value is prepended to the full urlencoded body (which itself
 * contains nonce=...), then SHA256'd, concatenated with the URL path, and
 * HMAC-SHA512'd with the base64-decoded API secret.
 */
export async function signKrakenRequest(
  urlPath: string,
  postData: string,
  apiSecret: string
): Promise<string> {
  const params = new URLSearchParams(postData);
  const nonce = params.get('nonce') || '';

  // SHA256(nonce + full urlencoded body)
  const sha256Input = nonce + postData;
  const sha256Digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sha256Input))
  );

  // message = urlPath + sha256Digest
  const urlPathBytes = new TextEncoder().encode(urlPath);
  const message = new Uint8Array(urlPathBytes.length + sha256Digest.length);
  message.set(urlPathBytes, 0);
  message.set(sha256Digest, urlPathBytes.length);

  // key = base64-decoded secret
  const secretBytes = Uint8Array.from(atob(apiSecret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Build the full Kraken authenticated header set.
 * Kraken uses API-Key and API-Sign headers with urlencoded bodies.
 */
export async function buildKrakenHeaders(
  apiKey: string,
  apiSecret: string,
  urlPath: string,
  postData: string
): Promise<Record<string, string>> {
  const sign = await signKrakenRequest(urlPath, postData, apiSecret);
  return {
    'API-Key': apiKey,
    'API-Sign': sign,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}