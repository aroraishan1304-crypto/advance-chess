const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function randomId() {
  return crypto.randomUUID();
}

export function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64urlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(value).length + 3) % 4);
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(keyText, valueText) {
  const key = await crypto.subtle.importKey("raw", enc.encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(valueText));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function pbkdf2Hash(password, saltBytes, iterations = 600_000) {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" }, material, 256);
  return new Uint8Array(bits);
}

export function utf8Bytes(text) {
  return enc.encode(text);
}

export function utf8Text(bytes) {
  return dec.decode(bytes);
}

export function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function passwordHash(password, pepper = "") {
  if (typeof password !== "string" || password.length < 8) throw new Error("Password must be at least 8 characters.");
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await pbkdf2Hash(`${password}${pepper}`, salt, 600_000);
  return `pbkdf2_sha256$600000$${base64url(salt)}$${base64url(derived)}`;
}

export async function passwordVerify(password, stored, pepper = "") {
  if (!stored) return false;
  const parts = String(stored).split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
  const salt = base64urlDecode(parts[2]);
  const expected = base64urlDecode(parts[3]);
  const actual = await pbkdf2Hash(`${password}${pepper}`, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function encryptText(plaintext, secretB64Url) {
  const keyBytes = base64urlDecode(secretB64Url);
  if (![16, 24, 32].includes(keyBytes.length)) throw new Error("ACCOUNT_ENCRYPTION_KEY must decode to 16, 24, or 32 bytes.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

export async function decryptText(token, secretB64Url) {
  const [ivPart, dataPart] = String(token).split(".");
  if (!ivPart || !dataPart) throw new Error("Invalid encrypted value.");
  const keyBytes = base64urlDecode(secretB64Url);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64urlDecode(ivPart) }, key, base64urlDecode(dataPart));
  return dec.decode(plaintext);
}

export function safeEqualString(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i % Math.max(x.length, 1)] || 0) ^ (y[i % Math.max(y.length, 1)] || 0);
  return diff === 0;
}

export function makeCookie(name, value, { maxAge = 2_592_000, httpOnly = true, sameSite = "Lax", secure = true, path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAge !== null) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name) {
  return makeCookie(name, "", { maxAge: 0 });
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function passwordPolicy(password) {
  if (typeof password !== "string") return { ok: false, reason: "Password is required." };
  if (password.length < 8) return { ok: false, reason: "Use at least 8 characters." };
  if (password.length > 1024) return { ok: false, reason: "Password is too long." };
  return { ok: true };
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

export function validateUsername(username) {
  const value = String(username || "").trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(value)) return { ok: false, reason: "Username must be 3–20 characters using letters, numbers, _ or -." };
  if (/^\d+$/.test(value)) return { ok: false, reason: "Username cannot contain only numbers." };
  return { ok: true, value, normalized: normalizeUsername(value) };
}

export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "support", "moderator", "mod", "official", "system", "security", "help", "guest", "anonymous", "advancedchess"
]);
