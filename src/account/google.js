import { base64url, randomToken, sha256Hex } from "./crypto.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_ORIGIN);
}

export async function buildGoogleStart(env, { state, codeChallenge, nonce, mode }) {
  if (!googleConfigured(env)) throw new Error("google_not_configured");
  const redirectUri = `${String(env.PUBLIC_ORIGIN).replace(/\/$/, "")}/api/account/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    ...(nonce ? { nonce } : {}),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account"
  });
  if (mode === "link") params.set("prompt", "select_account");
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export async function pkceChallenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export async function exchangeGoogleCode(env, code, verifier) {
  const redirectUri = `${String(env.PUBLIC_ORIGIN).replace(/\/$/, "")}/api/account/google/callback`;
  const body = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier });
  const r = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("google_token_exchange_failed");
  return r.json();
}

export async function googleUserinfo(accessToken) {
  const r = await fetch(GOOGLE_USERINFO, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("google_userinfo_failed");
  const user = await r.json();
  if (!user.sub || !user.email || user.email_verified !== true) throw new Error("google_email_not_verified");
  return { subject: String(user.sub), email: String(user.email).trim().toLowerCase(), displayName: String(user.name || user.email.split("@")[0]).slice(0, 80) };
}

export async function hashedState(state) { return sha256Hex(state); }
