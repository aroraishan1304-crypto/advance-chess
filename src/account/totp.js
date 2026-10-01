import { base64url, base64urlDecode, randomToken } from "./crypto.js";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomBase32(bytes = 20) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let bits = 0, value = 0, out = "";
  for (const b of data) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const clean = String(input || "").replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function uint64be(number) {
  const out = new Uint8Array(8);
  let n = BigInt(number);
  for (let i = 7; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}

async function hmacSha1(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

export async function totp(secret, time = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(time / 1000 / step);
  const mac = await hmacSha1(base32Decode(secret), uint64be(counter));
  const offset = mac[mac.length - 1] & 15;
  const code = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % (10 ** digits)).padStart(digits, "0");
}

export async function matchingTotpStep(secret, code, { now = Date.now(), window = 1, step = 30_000 } = {}) {
  const input = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(input)) return null;
  const currentStep = Math.floor(now / step);
  for (let offset = -window; offset <= window; offset++) {
    const candidateStep = currentStep + offset;
    if (await totp(secret, candidateStep * step) === input) return candidateStep;
  }
  return null;
}

export async function verifyTotp(secret, code, options = {}) {
  return (await matchingTotpStep(secret, code, options)) !== null;
}

export function otpauthUri({ issuer, accountName, secret }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params}`;
}

export function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) codes.push(randomToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase());
  return codes;
}
