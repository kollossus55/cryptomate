import crypto from "node:crypto";

/**
 * Provenance for PendingTradeApproval records.
 *
 * Approvals are created by the auto-trading worker (service role) and only the
 * server holds the signing key, so a valid signature proves a record was not
 * inserted straight through the entity API.
 */

function payload(approval) {
  return [
    approval.owner_email ?? "",
    approval.asset_symbol ?? "",
    approval.signal_strength ?? "",
    approval.entry_price ?? "",
    approval.position_size_usdt ?? "",
    approval.candle_interval ?? "",
    approval.expires_at ?? "",
  ].join("|");
}

function hmac(value, keyHex) {
  return crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(value).digest("hex");
}

export function signApproval(approval, keyHex) {
  return hmac(payload(approval), keyHex);
}

export function isWorkerApproval(approval, keyHex) {
  const token = approval?.provenance_token;
  if (typeof token !== "string" || token.length === 0) return false;
  const expected = signApproval(approval, keyHex);
  const given = Buffer.from(token, "hex");
  const want = Buffer.from(expected, "hex");
  if (given.length === 0 || given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}