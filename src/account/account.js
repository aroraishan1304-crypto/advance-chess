import {
  randomToken, randomId, sha256Hex, passwordHash, passwordVerify,
  encryptText, decryptText, normalizeEmail, normalizeUsername,
  validateUsername, RESERVED_USERNAMES, makeCookie, clearCookie, parseCookies
} from "./crypto.js";
import { generateBackupCodes, matchingTotpStep, otpauthUri, randomBase32, verifyTotp } from "./totp.js";
import { sendTransactionalEmail, emailLink, emailVerificationTemplate, passwordResetTemplate } from "./email.js";
import { buildGoogleStart, exchangeGoogleCode, googleUserinfo, pkceChallenge, googleConfigured } from "./google.js";

const SESSION_COOKIE = "__Host-ac_session";
const GUEST_COOKIE = "__Host-ac_guest";
const OAUTH_COOKIE = "__Host-ac_oauth";
const MFA_COOKIE = "__Host-ac_mfa";
const CSRF_COOKIE = "__Host-ac_csrf";
const SESSION_DAYS = 30;
const VERIFY_HOURS = 24;
const RESET_MINUTES = 30;
const OAUTH_MINUTES = 10;
const MFA_MINUTES = 10;
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const MAX_PROFILE_ABOUT = 500;
const MAX_AVATAR_BYTES = 512 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CATEGORIES = ["bullet", "blitz", "rapid", "classical"];
const PUZZLE_CATEGORY = "puzzle";
const DEFAULT_SETTINGS = {
  sound: true,
  animations: true,
  premoves: true,
  confirmMoves: false,
  coordinates: true,
  boardOrientation: "white",
  boardTheme: "classic",
  pieceSet: "classic"
};

const ok = (data = {}, status = 200, headers = {}) => json(data, status, headers);

export async function handleAccountRequest(request, env, ctx = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/chess.html") {
    return decorateChessPage(request, env);
  }
  if (!url.pathname.startsWith("/api/account") && !url.pathname.startsWith("/account")) return null;
  if (url.pathname.startsWith("/account") && !url.pathname.startsWith("/api/account")) return env.ASSETS?.fetch(request) || new Response("Account UI unavailable", { status: 503 });
  try {
    ensureBindings(env);
    await maybeClean(env, ctx);
    const method = request.method.toUpperCase();
    const route = url.pathname.replace(/^\/api\/account/, "") || "/";

    if (method === "OPTIONS") return cors(request, new Response(null, { status: 204 }));
    if (method !== "GET" && method !== "HEAD") enforceSameOrigin(request);

    if (route === "/health" && method === "GET") return cors(request, ok({ ok: true, service: "account-module", version: 1 }));
    if (route === "/signup" && method === "POST") return cors(request, await signup(request, env));
    if (route === "/login" && method === "POST") return cors(request, await login(request, env));
    if (route === "/login/2fa" && method === "POST") return cors(request, await login2FA(request, env));
    if (route === "/logout" && method === "POST") return cors(request, await logout(request, env));
    if (route === "/guest" && method === "POST") return cors(request, await createGuest(request, env));
    if (route === "/guest/migrate" && method === "POST") return cors(request, await migrateGuest(request, env));
    if (route === "/google/start" && method === "GET") return await googleStart(request, env);
    if (route === "/google/callback" && method === "GET") return await googleCallback(request, env);
    if (route === "/google/complete" && method === "POST") return cors(request, await googleComplete(request, env));
    if (route === "/username/check" && method === "GET") return cors(request, await usernameCheck(request, env));
    if (route === "/me" && method === "GET") return cors(request, await me(request, env));
    if (route.startsWith("/profile/") && method === "GET") return cors(request, await profile(request, env));
    if (route === "/profile" && method === "PATCH") return cors(request, await updateProfile(request, env));
    if (route === "/avatar" && method === "POST") return cors(request, await uploadAvatar(request, env));
    if (route.startsWith("/avatar/") && method === "GET") return await serveAvatar(request, env);
    if (route === "/settings" && method === "GET") return cors(request, await getSettings(request, env));
    if (route === "/settings" && method === "PATCH") return cors(request, await patchSettings(request, env));
    if (route === "/ratings" && method === "GET") return cors(request, await getRatings(request, env));
    if (route === "/stats" && method === "GET") return cors(request, await getStats(request, env));
    if (route === "/games" && method === "GET") return cors(request, await getGames(request, env));
    if (route === "/puzzles" && method === "GET") return cors(request, await getPuzzleStats(request, env));
    if (route === "/search" && method === "GET") return cors(request, await searchUsers(request, env));
    if (route === "/friends" && method === "GET") return cors(request, await getFriends(request, env));
    if (route === "/friends/request" && method === "POST") return cors(request, await friendRequest(request, env));
    if (route === "/friends/respond" && method === "POST") return cors(request, await friendRespond(request, env));
    if (route === "/friends/remove" && method === "POST") return cors(request, await friendRemove(request, env));
    if (route === "/follow" && method === "POST") return cors(request, await follow(request, env));
    if (route === "/unfollow" && method === "POST") return cors(request, await unfollow(request, env));
    if (route === "/block" && method === "POST") return cors(request, await block(request, env));
    if (route === "/unblock" && method === "POST") return cors(request, await unblock(request, env));
    if (route === "/report" && method === "POST") return cors(request, await report(request, env));
    if (route === "/notifications" && method === "GET") return cors(request, await notifications(request, env));
    if (route === "/notifications/read" && method === "POST") return cors(request, await markNotificationsRead(request, env));
    if (route === "/challenge" && method === "POST") return cors(request, await createChallenge(request, env));
    if (route === "/challenges" && method === "GET") return cors(request, await getChallenges(request, env));
    if (route === "/challenge/respond" && method === "POST") return cors(request, await challengeRespond(request, env));
    if (route === "/leaderboard" && method === "GET") return cors(request, await leaderboard(request, env));
    if (route === "/badges" && method === "GET") return cors(request, await getBadges(request, env));
    if (route === "/security/sessions" && method === "GET") return cors(request, await listSessions(request, env));
    if (route === "/security/sessions/revoke" && method === "POST") return cors(request, await revokeSession(request, env));
    if (route === "/security/sessions/revoke-all" && method === "POST") return cors(request, await revokeAllOtherSessions(request, env));
    if (route === "/security/password" && method === "POST") return cors(request, await changePassword(request, env));
    if (route === "/security/2fa/setup" && method === "POST") return cors(request, await setup2FA(request, env));
    if (route === "/security/2fa/verify" && method === "POST") return cors(request, await verify2FA(request, env));
    if (route === "/security/2fa/disable" && method === "POST") return cors(request, await disable2FA(request, env));
    if (route === "/verify-email" && method === "POST") return cors(request, await verifyEmail(request, env));
    if (route === "/verify-email-change" && method === "POST") return cors(request, await verifyEmailChange(request, env));
    if (route === "/verify-email/resend" && method === "POST") return cors(request, await resendVerification(request, env));
    if (route === "/forgot-password" && method === "POST") return cors(request, await forgotPassword(request, env));
    if (route === "/reset-password" && method === "POST") return cors(request, await resetPassword(request, env));
    if (route === "/email/change" && method === "POST") return cors(request, await requestEmailChange(request, env));
    if (route === "/export" && method === "GET") return cors(request, await exportData(request, env));
    if (route === "/delete" && method === "POST") return cors(request, await deleteAccount(request, env));
    if (route === "/internal/game-result" && method === "POST") return cors(request, await internalGameResult(request, env));
    if (route === "/internal/guest-game-result" && method === "POST") return cors(request, await internalGuestGameResult(request, env));
    if (route === "/internal/puzzle-result" && method === "POST") return cors(request, await internalPuzzleResult(request, env));
    if (route === "/internal/guest-puzzle-result" && method === "POST") return cors(request, await internalGuestPuzzleResult(request, env));
    if (route === "/tournaments" && method === "GET") return cors(request, await listTournaments(request, env));
    if (route === "/tournaments/join" && method === "POST") return cors(request, await joinTournament(request, env));
    if (route === "/tournaments/standings" && method === "GET") return cors(request, await tournamentStandings(request, env));
    return cors(request, ok({ error: "not_found" }, 404));
  } catch (error) {
    console.error?.("account-module", error);
    return cors(request, ok({ error: normalizeError(error) }, statusForError(error)));
  }
}

export async function recordGameResult(env, result) {
  return applyGameResult(env, result);
}

export async function resolvePlayerIdentity(request, env) {
  const session = await currentSession(request, env);
  if (session) {
    return {
      kind: "Player",
      userId: session.user_id,
      username: session.username
    };
  }

  const guest = await currentGuest(request, env);
  if (guest) {
    return {
      kind: "Guest",
      guestId: guest.id,
      username: guest.username
    };
  }

  return null;
}

function ensureBindings(env) {
  if (!env.ACCOUNTS) throw new Error("ACCOUNTS_D1_BINDING_MISSING");
  if (!env.PUBLIC_ORIGIN) throw new Error("public_origin_not_configured");
  if (!env.ACCOUNT_ENCRYPTION_KEY) throw new Error("ACCOUNT_ENCRYPTION_KEY_NOT_CONFIGURED");
}

function normalizeError(error) {
  const code = error?.message || "server_error";
  return /^[A-Za-z0-9_\-]{3,80}$/.test(code) ? code.toLowerCase() : "server_error";
}
function statusForError(error) {
  const code = normalizeError(error);
  if (code.includes("not_found")) return 404;
  if (code.includes("not_configured") || code.includes("binding_missing")) return 503;
  if (code.includes("already") || code.includes("taken") || code.includes("conflict")) return 409;
  if (code.includes("unauthorized") || code.includes("invalid_session") || code.includes("invalid_csrf")) return 401;
  if (code.includes("forbidden")) return 403;
  if (code.includes("rate_limit")) return 429;
  if (code.includes("invalid") || code.includes("required") || code.includes("weak")) return 400;
  return 500;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
function cors(request, response) {
  const origin = request.headers.get("Origin");
  if (origin && /^https:\/\//.test(origin)) response.headers.set("Vary", "Origin");
  return response;
}
function enforceSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new Error("origin_mismatch");
}

async function bodyJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 128 * 1024) throw new Error("request_too_large");
  const data = await request.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid_json");
  return data;
}

async function maybeClean(env, ctx) {
  if (!ctx?.waitUntil || Math.random() > 0.05) return;
  ctx.waitUntil(env.ACCOUNTS.prepare("DELETE FROM email_tokens WHERE used_at IS NOT NULL OR expires_at < ?").bind(Date.now()).run().catch(() => {}));
  ctx.waitUntil(env.ACCOUNTS.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(Date.now()).run().catch(() => {}));
  ctx.waitUntil(env.ACCOUNTS.prepare("DELETE FROM oauth_pending WHERE expires_at < ?").bind(Date.now()).run().catch(() => {}));
  ctx.waitUntil(env.ACCOUNTS.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run().catch(() => {}));
}

async function rateLimit(env, key, limit = 8, periodSeconds = 60) {
  if (env.ACCOUNT_RATE_LIMITER?.limit) {
    const result = await env.ACCOUNT_RATE_LIMITER.limit({ key });
    if (!result.success) throw new Error("rate_limit_exceeded");
    return;
  }
  const now = Date.now();
  const windowStart = Math.floor(now / (periodSeconds * 1000)) * (periodSeconds * 1000);
  const hash = await sha256Hex(key);
  const current = await env.ACCOUNTS.prepare("SELECT count FROM rate_limits WHERE key_hash=? AND window_start=?").bind(hash, windowStart).first();
  if ((current?.count || 0) >= limit) throw new Error("rate_limit_exceeded");
  const updated = await env.ACCOUNTS.prepare("INSERT INTO rate_limits(key_hash,window_start,count) VALUES(?,?,1) ON CONFLICT(key_hash,window_start) DO UPDATE SET count=count+1").bind(hash, windowStart).run();
  const after = await env.ACCOUNTS.prepare("SELECT count FROM rate_limits WHERE key_hash=? AND window_start=?").bind(hash, windowStart).first();
  if (Number(after?.count || 0) > limit) {
    await env.ACCOUNTS.prepare("UPDATE rate_limits SET count=MAX(count-1,0) WHERE key_hash=? AND window_start=?").bind(hash, windowStart).run();
    throw new Error("rate_limit_exceeded");
  }
}

async function currentSession(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.ACCOUNTS.prepare(`SELECT s.id,s.user_id,s.csrf_token_hash,s.expires_at,s.last_seen_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).bind(tokenHash, Date.now()).first();
  if (!session) return null;
  const now = Date.now();
  if (now - Number(session.last_seen_at || 0) >= 60_000) {
    await env.ACCOUNTS.prepare("UPDATE sessions SET last_seen_at=? WHERE id=?").bind(now, session.id).run();
    if (session.online_visibility) await env.ACCOUNTS.prepare("UPDATE users SET last_seen_at=?, updated_at=? WHERE id=?").bind(now, now, session.user_id).run();
  }
  return session;
}

async function requireAuth(request, env) {
  const session = await currentSession(request, env);
  if (!session) throw new Error("unauthorized");
  return session;
}

async function requireCsrf(request, session) {
  const csrf = request.headers.get("X-CSRF-Token");
  if (!csrf) throw new Error("invalid_csrf");
  const hash = await sha256Hex(csrf);
  if (!constantEqual(hash, session.csrf_token_hash)) throw new Error("invalid_csrf");
}

function constantEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i % Math.max(x.length, 1)] || 0) ^ (y[i % Math.max(y.length, 1)] || 0);
  return diff === 0;
}

async function issueSession(env, userId, request, extraCookies = []) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  await env.ACCOUNTS.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at,user_agent,ip_hash) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(randomId(), userId, await sha256Hex(token), await sha256Hex(csrf), now, now + SESSION_DAYS * 86400000, now, request.headers.get("User-Agent")?.slice(0, 300) || null, await sha256Hex(request.headers.get("CF-Connecting-IP") || "anonymous"))
    .run();
  const cookies = [makeCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 }), makeCookie(CSRF_COOKIE, csrf, { maxAge: SESSION_DAYS * 86400, httpOnly: false }), ...extraCookies];
  return { csrfToken: csrf, cookies };
}

async function decorateChessPage(request, env) {
  if (!env.ASSETS) return new Response("Chess assets unavailable", { status: 503 });
  if (request.method !== "GET") return env.ASSETS.fetch(request);
  const upstream = await env.ASSETS.fetch(request);
  if (!upstream.ok) return upstream;
  const html = await upstream.text();
  const tag = '<script type="module" src="/account/bridge.js"></script>';
  if (html.includes('/account/bridge.js')) return new Response(html, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
  const body = html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : `${html}${tag}`;
  const headers = new Headers(upstream.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function responseWithCookies(data, cookies, status = 200) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  cookies.forEach(c => headers.append("Set-Cookie", c));
  return new Response(JSON.stringify(data), { status, headers });
}

async function mergeGuestIntoUser(request, env, userId) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[GUEST_COOKIE];
  if (!token) return false;
  const guest = await env.ACCOUNTS.prepare("SELECT * FROM guest_accounts WHERE token_hash=?").bind(await sha256Hex(token)).first();
  if (!guest) return false;
  let data={}; try { data=JSON.parse(guest.data_json||"{}"); } catch {}
  const registeredRatings=await ratingRows(env,userId);
  const byCat=new Map(registeredRatings.map(r=>[r.category,r]));
  const batches=[];
  for(const [category,raw] of Object.entries(data.ratings||{})){
    if(!CATEGORIES.includes(category)||category==='puzzle'||!raw)continue;
    const r=byCat.get(category); const guestGames=Math.max(0,Number(raw.games)||0); if(!guestGames)continue;
    if(r && r.games===0){batches.push(env.ACCOUNTS.prepare("UPDATE ratings SET rating=?,games=?,wins=?,draws=?,losses=?,updated_at=? WHERE user_id=? AND category=?").bind(Math.max(100,Math.floor(Number(raw.rating)||1200)),guestGames,Math.max(0,Number(raw.wins)||0),Math.max(0,Number(raw.draws)||0),Math.max(0,Number(raw.losses)||0),Date.now(),userId,category));}
  }
  const gp=data.puzzles||{};
  if(Number(gp.games)||0){const p=await env.ACCOUNTS.prepare("SELECT * FROM puzzle_stats WHERE user_id=?").bind(userId).first();if(p&&p.games===0)batches.push(env.ACCOUNTS.prepare("UPDATE puzzle_stats SET rating=?,games=?,solves=?,streak=?,best_streak=?,updated_at=? WHERE user_id=?").bind(Math.max(100,Number(gp.rating)||1200),Math.max(0,Number(gp.games)||0),Math.max(0,Number(gp.solves)||0),Math.max(0,Number(gp.streak)||0),Math.max(0,Number(gp.bestStreak)||0),Date.now(),userId));}
  batches.push(env.ACCOUNTS.prepare("UPDATE games SET white_user_id=? WHERE guest_white_id=? AND white_user_id IS NULL").bind(userId,guest.id),env.ACCOUNTS.prepare("UPDATE games SET black_user_id=? WHERE guest_black_id=? AND black_user_id IS NULL").bind(userId,guest.id),env.ACCOUNTS.prepare("DELETE FROM guest_accounts WHERE id=?").bind(guest.id));
  await env.ACCOUNTS.batch(batches);
  return true;
}

async function signup(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  await rateLimit(env, `signup:${ip}`, 5, 60);
  const body = await bodyJson(request);
  const email = normalizeEmail(body.email);
  const usernameResult = validateUsername(body.username);
  if (!usernameResult.ok) throw new Error("invalid_username");
  if (RESERVED_USERNAMES.has(usernameResult.normalized)) throw new Error("username_reserved");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_email");
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("email_not_configured");
  const password = String(body.password || "");
  if (password.length < 8 || password.length > 1024) throw new Error("invalid_password");
  const existing = await env.ACCOUNTS.prepare("SELECT id FROM users WHERE username_norm=? OR email_norm=?").bind(usernameResult.normalized, email).first();
  if (existing) throw new Error("username_or_email_taken");
  const id = randomId();
  const now = Date.now();
  const hash = await passwordHash(password, env.PASSWORD_PEPPER || "");
  try {
    await createUserRows(env, { id, username: usernameResult.value, email, passwordHash: hash, emailVerified: 0, displayName: usernameResult.value, now });
  } catch (error) {
    if (error?.message === "account_conflict") throw new Error("username_or_email_taken");
    throw error;
  }
  const rawToken = randomToken(32);
  await env.ACCOUNTS.prepare("INSERT INTO email_tokens(id,user_id,kind,token_hash,meta_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)")
    .bind(randomId(), id, "verify_email", await sha256Hex(rawToken), "{}", now, now + VERIFY_HOURS * 3600000).run();
  const link = emailLink(env, "/account/index.html#verify-email", rawToken);
  const tpl = emailVerificationTemplate({ username: usernameResult.value, link });
  try { await sendTransactionalEmail(env, { to: email, ...tpl }); } catch (e) { if (e.message === "email_not_configured") throw e; }
  const session = await issueSession(env, id, request);
  let migratedGuest = false;
  try { migratedGuest = await mergeGuestIntoUser(request, env, id); } catch (e) { console.error?.("guest migration during signup", e); }
  const cookies = migratedGuest ? [...session.cookies, clearCookie(GUEST_COOKIE)] : session.cookies;
  return responseWithCookies({ ok: true, user: publicUser(await userById(env, id)), csrfToken: session.csrfToken, emailVerificationRequired: true, guestMigrated: migratedGuest }, cookies);
}

async function createUserRows(env, { id, username, email, passwordHash, emailVerified, displayName, now }) {
  const statements = [
    env.ACCOUNTS.prepare(`INSERT INTO users(id,username,username_norm,email,email_norm,display_name,email_verified,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, username, normalizeUsername(username), email || null, email ? normalizeEmail(email) : null, displayName || username, emailVerified ? 1 : 0, passwordHash || null, now, now)
  ];
  for (const category of [...CATEGORIES, PUZZLE_CATEGORY]) {
    statements.push(env.ACCOUNTS.prepare("INSERT INTO ratings(user_id,category,updated_at) VALUES(?,?,?)").bind(id, category, now));
  }
  statements.push(env.ACCOUNTS.prepare("INSERT INTO puzzle_stats(user_id,updated_at) VALUES(?,?)").bind(id, now));
  statements.push(env.ACCOUNTS.prepare("INSERT INTO user_settings(user_id,settings_json,updated_at) VALUES(?,?,?)").bind(id, JSON.stringify(DEFAULT_SETTINGS), now));
  try {
    await env.ACCOUNTS.batch(statements);
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) throw new Error("account_conflict");
    throw error;
  }
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  await rateLimit(env, `login-ip:${ip}`, 15, 60);
  const body = await bodyJson(request);
  const email = normalizeEmail(body.email);
  await rateLimit(env, `login-account:${email}`, 10, 60);
  const user = await env.ACCOUNTS.prepare("SELECT * FROM users WHERE email_norm=? AND status='active'").bind(email).first();
  if (!user || !user.password_hash) throw new Error("invalid_credentials");
  const valid = await passwordVerify(String(body.password || ""), user.password_hash, env.PASSWORD_PEPPER || "");
  if (!valid) throw new Error("invalid_credentials");
  if (user.two_factor_enabled) {
    const challenge = randomToken(24);
    const now = Date.now();
    await env.ACCOUNTS.prepare("INSERT INTO login_challenges VALUES(?,?,?,?,?)").bind(randomId(), await sha256Hex(challenge), user.id, now + MFA_MINUTES * 60000, now).run();
    return responseWithCookies({ ok: true, requires2FA: true }, [makeCookie(MFA_COOKIE, challenge, { maxAge: MFA_MINUTES * 60 })]);
  }
  const session = await issueSession(env, user.id, request);
  return responseWithCookies({ ok: true, user: publicUser(user), csrfToken: session.csrfToken }, session.cookies);
}

async function login2FA(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  await rateLimit(env, `mfa-ip:${ip}`, 10, 60);
  const cookies = parseCookies(request.headers.get("Cookie"));
  const challenge = cookies[MFA_COOKIE];
  if (!challenge) throw new Error("invalid_mfa_challenge");
  const hash = await sha256Hex(challenge);
  const record = await env.ACCOUNTS.prepare("SELECT * FROM login_challenges WHERE token_hash=? AND expires_at>?").bind(hash, Date.now()).first();
  if (!record) throw new Error("invalid_mfa_challenge");
  const user = await env.ACCOUNTS.prepare("SELECT * FROM users WHERE id=? AND status='active'").bind(record.user_id).first();
  const body = await bodyJson(request);
  const okCode = await verifyUser2FACode(env, user, body.code);
  if (!okCode) throw new Error("invalid_2fa_code");
  await env.ACCOUNTS.prepare("DELETE FROM login_challenges WHERE token_hash=?").bind(hash).run();
  const session = await issueSession(env, user.id, request, [clearCookie(MFA_COOKIE)]);
  return responseWithCookies({ ok: true, user: publicUser(user), csrfToken: session.csrfToken }, session.cookies);
}

async function verifyUser2FACode(env, user, code) {
  if (!user?.two_factor_secret_enc) return false;
  const secret = await decryptText(user.two_factor_secret_enc, env.ACCOUNT_ENCRYPTION_KEY);
  const matchedStep = await matchingTotpStep(secret, code);
  if (matchedStep !== null) {
    const last = Number(user.two_factor_last_step ?? -1);
    if (matchedStep <= last) return false;
    const result = await env.ACCOUNTS.prepare("UPDATE users SET two_factor_last_step=?,updated_at=? WHERE id=? AND (two_factor_last_step IS NULL OR two_factor_last_step<?)")
      .bind(matchedStep, Date.now(), user.id, matchedStep).run();
    return Number(result?.meta?.changes || 0) === 1;
  }
  const codeHash = await sha256Hex(String(code || "").trim().toUpperCase());
  const backup = await env.ACCOUNTS.prepare("SELECT id FROM two_factor_backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL").bind(user.id, codeHash).first();
  if (!backup) return false;
  const result = await env.ACCOUNTS.prepare("UPDATE two_factor_backup_codes SET used_at=? WHERE id=? AND used_at IS NULL").bind(Date.now(), backup.id).run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function logout(request, env) {
  const session = await currentSession(request, env);
  if (!session) return responseWithCookies({ ok: true }, [clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE)]);
  await requireCsrf(request, session);
  await env.ACCOUNTS.prepare("DELETE FROM sessions WHERE id=?").bind(session.id).run();
  return responseWithCookies({ ok: true }, [clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE)]);
}

async function createGuest(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  if (cookies[GUEST_COOKIE]) {
    const existing = await env.ACCOUNTS.prepare("SELECT * FROM guest_accounts WHERE token_hash=? AND last_seen_at>? ")
      .bind(await sha256Hex(cookies[GUEST_COOKIE]), Date.now() - 90 * 86400000).first();
    if (existing) {
      let data = {};
      try { data = JSON.parse(existing.data_json || "{}"); } catch {}
      let username = String(data.username || "");
      if (!username) {
        username = await uniqueGuestUsername(env);
        data.username = username;
        data.displayName = username;
        await env.ACCOUNTS.prepare("UPDATE guest_accounts SET data_json=?,last_seen_at=? WHERE id=?")
          .bind(JSON.stringify(data), Date.now(), existing.id).run();
      } else {
        await env.ACCOUNTS.prepare("UPDATE guest_accounts SET last_seen_at=? WHERE id=?").bind(Date.now(), existing.id).run();
      }
      return responseWithCookies({ ok: true, guest: { id: existing.id, username, label: username, avatarUrl: "/account/default-avatar.svg" }, csrfToken: null, existing: true }, [makeCookie(GUEST_COOKIE, cookies[GUEST_COOKIE], { maxAge: 90 * 86400 })]);
    }
  }
  const token = randomToken(24);
  const now = Date.now();
  const id = randomId();
  const username = await uniqueGuestUsername(env);
  const data = { username, displayName: username, ratings: {}, puzzles: {}, games: [] };
  await env.ACCOUNTS.prepare("INSERT INTO guest_accounts(id,token_hash,created_at,last_seen_at,data_json) VALUES(?,?,?,?,?)").bind(id, await sha256Hex(token), now, now, JSON.stringify(data)).run();
  return responseWithCookies({ ok: true, guest: { id, username, label: username, avatarUrl: "/account/default-avatar.svg" }, csrfToken: null, existing: false }, [makeCookie(GUEST_COOKIE, token, { maxAge: 90 * 86400 })]);
}

const GUEST_NAME_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function uniqueGuestUsername(env) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let suffix = "";
    for (const b of bytes) suffix += GUEST_NAME_ALPHABET[b % GUEST_NAME_ALPHABET.length];
    const username = `Guest_${suffix}`;
    const row = await env.ACCOUNTS.prepare("SELECT 1 FROM guest_accounts WHERE data_json LIKE ? LIMIT 1").bind(`%\"username\":\"${username}\"%`).first();
    if (!row) return username;
  }
  return `Guest_${randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`;
}

async function migrateGuest(request, env) {
  const session = await requireAuth(request, env);
  await requireCsrf(request, session);
  const migrated = await mergeGuestIntoUser(request, env, session.user_id);
  return responseWithCookies({ ok: true, migrated }, migrated ? [clearCookie(GUEST_COOKIE)] : []);
}

async function googleStart(request, env) {
  if (!googleConfigured(env)) throw new Error("google_not_configured");
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "link" ? "link" : "login";
  let session = null;
  if (mode === "link") session = await requireAuth(request, env);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await pkceChallenge(verifier);
  const nonce = randomToken(24);
  const now = Date.now();
  await env.ACCOUNTS.prepare("INSERT INTO oauth_states(id,state_hash,nonce,code_verifier,mode,user_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(randomId(), await sha256Hex(state), nonce, verifier, mode, session?.user_id || null, now, now + OAUTH_MINUTES * 60000).run();
  const googleUrl = await buildGoogleStart(env, { state, codeChallenge: challenge, nonce, mode });
  return new Response(null, { status: 302, headers: { location: googleUrl, "Set-Cookie": makeCookie(OAUTH_COOKIE, state, { maxAge: OAUTH_MINUTES * 60 }) } });
}

async function googleCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const cookies = parseCookies(request.headers.get("Cookie"));
  if (!state || !constantEqual(state, cookies[OAUTH_COOKIE] || "")) throw new Error("oauth_state_mismatch");
  const stateRow = await env.ACCOUNTS.prepare("SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?").bind(await sha256Hex(state), Date.now()).first();
  if (!stateRow) throw new Error("oauth_state_expired");
  if (url.searchParams.get("error")) throw new Error("google_login_cancelled");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("google_code_missing");
  const tokens = await exchangeGoogleCode(env, code, stateRow.code_verifier);
  const profile = await googleUserinfo(tokens.access_token);
  await env.ACCOUNTS.prepare("DELETE FROM oauth_states WHERE id=?").bind(stateRow.id).run();
  if (stateRow.mode === "link") {
    const current = await currentSession(request, env);
    if (!current || current.user_id !== stateRow.user_id) throw new Error("unauthorized");
    const existing = await env.ACCOUNTS.prepare("SELECT user_id FROM auth_identities WHERE provider='google' AND provider_subject=?").bind(profile.subject).first();
    if (existing && existing.user_id !== current.user_id) throw new Error("google_account_already_linked");
    await env.ACCOUNTS.prepare("INSERT OR IGNORE INTO auth_identities(id,user_id,provider,provider_subject,created_at) VALUES(?,?,?,?,?)").bind(randomId(), current.user_id, "google", profile.subject, Date.now()).run();
    return new Response(null, { status: 302, headers: { location: "/account/index.html#settings?google=linked", "Set-Cookie": clearCookie(OAUTH_COOKIE) } });
  }
  const identity = await env.ACCOUNTS.prepare("SELECT user_id FROM auth_identities WHERE provider='google' AND provider_subject=?").bind(profile.subject).first();
  if (identity) {
    const session = await issueSession(env, identity.user_id, request, [clearCookie(OAUTH_COOKIE)]);
    return responseRedirectWithCookies("/account/index.html#profile", session.cookies);
  }
  const emailOwner = await env.ACCOUNTS.prepare("SELECT id,email_verified FROM users WHERE email_norm=? AND status='active'").bind(profile.email).first();
  if (emailOwner) throw new Error("google_email_exists_sign_in_and_link");
  const pending = randomToken(32);
  await env.ACCOUNTS.prepare("INSERT INTO oauth_pending(id,token_hash,provider,provider_subject,email,display_name,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(randomId(), await sha256Hex(pending), "google", profile.subject, profile.email, profile.displayName, Date.now(), Date.now() + OAUTH_MINUTES * 60000).run();
  return responseRedirectWithCookies(`/account/index.html#google-complete?token=${encodeURIComponent(pending)}`, [clearCookie(OAUTH_COOKIE)]);
}

function responseRedirectWithCookies(location, cookies) {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

async function googleComplete(request, env) {
  const body = await bodyJson(request);
  const token = String(body.token || "");
  const row = await env.ACCOUNTS.prepare("SELECT * FROM oauth_pending WHERE token_hash=? AND expires_at>?").bind(await sha256Hex(token), Date.now()).first();
  if (!row) throw new Error("google_onboarding_expired");
  const validation = validateUsername(body.username);
  if (!validation.ok || RESERVED_USERNAMES.has(validation.normalized)) throw new Error("invalid_username");
  if (await env.ACCOUNTS.prepare("SELECT id FROM users WHERE username_norm=?").bind(validation.normalized).first()) throw new Error("username_taken");
  const userId = randomId();
  const now = Date.now();
  try {
    await createUserRows(env, { id: userId, username: validation.value, email: row.email, passwordHash: null, emailVerified: 1, displayName: validation.value, now });
  } catch (error) {
    if (error?.message === "account_conflict") throw new Error("username_taken");
    throw error;
  }
  await env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject,created_at) VALUES(?,?,?,?,?)").bind(randomId(), userId, "google", row.provider_subject, now),
    env.ACCOUNTS.prepare("DELETE FROM oauth_pending WHERE id=?").bind(row.id)
  ]);
  const session = await issueSession(env, userId, request);
  let migratedGuest = false;
  try { migratedGuest = await mergeGuestIntoUser(request, env, userId); } catch (e) { console.error?.("guest migration during google signup", e); }
  const cookies = migratedGuest ? [...session.cookies, clearCookie(GUEST_COOKIE)] : session.cookies;
  return responseWithCookies({ ok: true, user: publicUser(await userById(env, userId)), csrfToken: session.csrfToken, guestMigrated: migratedGuest }, cookies);
}

async function usernameCheck(request, env) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("username") || "";
  const validation = validateUsername(raw);
  if (!validation.ok) return ok({ available: false, reason: validation.reason });
  const taken = await env.ACCOUNTS.prepare("SELECT id FROM users WHERE username_norm=? AND status='active'").bind(validation.normalized).first();
  return ok({ available: !taken && !RESERVED_USERNAMES.has(validation.normalized), username: validation.value, normalized: validation.normalized });
}

async function currentGuest(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[GUEST_COOKIE];
  if (!token) return null;
  const row = await env.ACCOUNTS.prepare("SELECT * FROM guest_accounts WHERE token_hash=? AND last_seen_at>? ").bind(await sha256Hex(token), Date.now() - 90 * 86400000).first();
  if (!row) return null;
  await env.ACCOUNTS.prepare("UPDATE guest_accounts SET last_seen_at=? WHERE id=?").bind(Date.now(), row.id).run();
  let data={}; try { data=JSON.parse(row.data_json||"{}"); } catch {}
  let username = String(data.username || "");
  if (!username) {
    username = await uniqueGuestUsername(env);
    data.username = username;
    data.displayName = username;
    await env.ACCOUNTS.prepare("UPDATE guest_accounts SET data_json=? WHERE id=?").bind(JSON.stringify(data), row.id).run();
  }
  return {id:row.id,username,label:username,data};
}

async function me(request, env) {
  const session = await currentSession(request, env);
  if (!session) {
    const guest = await currentGuest(request, env);
    return guest ? ok({ authenticated:false, guest:true, guestProfile:{id:guest.id,username:guest.username,label:guest.label,avatarUrl:"/account/default-avatar.svg", data:guest.data} }) : ok({ authenticated: false });
  }
  const user = publicUser(session, true);
  const settings = await settingsForUser(env, session.user_id);
  const ratings = await ratingRows(env, session.user_id);
  const puzzle = await env.ACCOUNTS.prepare("SELECT * FROM puzzle_stats WHERE user_id=?").bind(session.user_id).first();
  return ok({ authenticated: true, user, csrfToken: parseCookies(request.headers.get("Cookie"))[CSRF_COOKIE] || null, settings, ratings, puzzle });
}


async function profile(request, env) {
  const url = new URL(request.url);
  const username = decodeURIComponent(url.pathname.split("/").pop() || "");
  const current = await currentSession(request, env);
  const user = await env.ACCOUNTS.prepare("SELECT * FROM users WHERE username_norm=? AND status='active'").bind(normalizeUsername(username)).first();
  if (!user) throw new Error("user_not_found");
  if (current?.user_id && await isBlockedEither(env, current.user_id, user.id)) throw new Error("profile_unavailable");
  if (user.profile_visibility === "private" && current?.user_id !== user.id) throw new Error("profile_private");
  if (user.profile_visibility === "friends" && current?.user_id !== user.id && !(await areFriends(env, current?.user_id, user.id))) throw new Error("profile_private");
  const ratings = await ratingRows(env, user.id);
  const stats = await statsForUser(env, user.id);
  const puzzle = await env.ACCOUNTS.prepare("SELECT rating,games,solves,streak,best_streak FROM puzzle_stats WHERE user_id=?").bind(user.id).first();
  const [friendCount, followerCount, followingCount] = await Promise.all([
    env.ACCOUNTS.prepare("SELECT COUNT(*) c FROM friendships WHERE status='accepted' AND (user_low=? OR user_high=?)").bind(user.id,user.id).first(),
    env.ACCOUNTS.prepare("SELECT COUNT(*) c FROM follows WHERE following_id=?").bind(user.id).first(),
    env.ACCOUNTS.prepare("SELECT COUNT(*) c FROM follows WHERE follower_id=?").bind(user.id).first()
  ]);
  return ok({ user: publicUser(user, current?.user_id === user.id), ratings, puzzle, stats, social:{friends:Number(friendCount?.c||0),followers:Number(followerCount?.c||0),following:Number(followingCount?.c||0)} });
}

async function updateProfile(request, env) {
  const session = await requireAuth(request, env); await requireCsrf(request, session);
  const body = await bodyJson(request);
  let username = session.username;
  if (body.username !== undefined) {
    const validation = validateUsername(body.username);
    if (!validation.ok || RESERVED_USERNAMES.has(validation.normalized)) throw new Error("invalid_username");
    const existing = await env.ACCOUNTS.prepare("SELECT id FROM users WHERE username_norm=? AND id<>? AND status='active'").bind(validation.normalized, session.user_id).first();
    if (existing) throw new Error("username_taken");
    username = validation.value;
  }
  const about = body.about === undefined ? session.about : String(body.about).slice(0, MAX_PROFILE_ABOUT);
  const country = body.country === undefined ? session.country : normalizeCountry(body.country);
  const timezone = body.timezone === undefined ? session.timezone : normalizeTimezone(body.timezone);
  const displayName = body.displayName === undefined ? session.display_name : String(body.displayName).trim().slice(0, 50);
  await env.ACCOUNTS.prepare("UPDATE users SET username=?,username_norm=?,display_name=?,about=?,country=?,timezone=?,updated_at=? WHERE id=?").bind(username, normalizeUsername(username), displayName || username, about, country, timezone, Date.now(), session.user_id).run();
  return ok({ ok: true, user: publicUser(await userById(env, session.user_id), true) });
}

function normalizeCountry(value) { const v = String(value || "").trim().toUpperCase(); return /^[A-Z]{2}$/.test(v) ? v : null; }
function normalizeTimezone(value) { const v = String(value || "").trim(); return v.length <= 80 ? v || null : null; }

function detectAvatarType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

async function uploadAvatar(request, env) {
  const session = await requireAuth(request, env);
  await requireCsrf(request, session);
  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) throw new Error("avatar_required");
  if (!ALLOWED_AVATAR_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_AVATAR_BYTES) throw new Error("invalid_avatar");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectAvatarType(bytes);
  if (!detected || detected.mime !== file.type) throw new Error("invalid_avatar");
  const key = `${session.user_id}-${randomId()}.${detected.ext}`;
  const now = Date.now();
  await env.ACCOUNTS.prepare("UPDATE users SET avatar_key=?,avatar_mime=?,avatar_data=?,updated_at=? WHERE id=?")
    .bind(key, detected.mime, bytes.buffer, now, session.user_id)
    .run();
  return ok({ ok: true, avatarUrl: `/api/account/avatar/${encodeURIComponent(session.user_id)}?v=${now}` });
}

async function serveAvatar(request, env) {
  const userId = decodeURIComponent(new URL(request.url).pathname.split("/").pop() || "");
  const user = await env.ACCOUNTS.prepare("SELECT id,avatar_key,avatar_mime,avatar_data,profile_visibility,status FROM users WHERE id=? AND status='active'")
    .bind(userId).first();
  if (!user?.avatar_key || user.avatar_data == null || !user.avatar_mime) throw new Error("avatar_not_found");
  if (user.profile_visibility !== "public") {
    const current = await currentSession(request, env);
    if (!current || current.user_id !== user.id) {
      if (user.profile_visibility !== "friends" || !(await areFriends(env, current?.user_id, user.id))) throw new Error("profile_unavailable");
    }
  }
  const bytes = user.avatar_data instanceof ArrayBuffer
    ? new Uint8Array(user.avatar_data)
    : new Uint8Array(Array.isArray(user.avatar_data) ? user.avatar_data : Object.values(user.avatar_data));
  const headers = new Headers({
    "Content-Type": user.avatar_mime,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff"
  });
  return new Response(bytes, { headers });
}

async function getSettings(request, env) { const session = await requireAuth(request, env); return ok({ settings: await settingsForUser(env, session.user_id), csrfToken: parseCookies(request.headers.get("Cookie"))[CSRF_COOKIE] || null }); }
async function patchSettings(request, env) {
  const session = await requireAuth(request, env); await requireCsrf(request, session); const body = await bodyJson(request); const current = await settingsForUser(env, session.user_id);
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS)) if (body[key] !== undefined) next[key] = sanitizeSetting(key, body[key]);
  await env.ACCOUNTS.prepare("UPDATE user_settings SET settings_json=?,updated_at=? WHERE user_id=?").bind(JSON.stringify(next), Date.now(), session.user_id).run();
  const privacy = {
    profileVisibility: ["public","friends","private"].includes(body.profileVisibility) ? body.profileVisibility : session.profile_visibility,
    onlineVisibility: body.onlineVisibility === undefined ? !!session.online_visibility : Boolean(body.onlineVisibility),
    friendRequestSetting: ["everyone","friends_of_friends","nobody"].includes(body.friendRequestSetting) ? body.friendRequestSetting : session.friend_request_setting,
    challengeSetting: ["everyone","friends","nobody"].includes(body.challengeSetting) ? body.challengeSetting : session.challenge_setting,
    searchable: body.searchable === undefined ? !!session.searchable : Boolean(body.searchable)
  };
  await env.ACCOUNTS.prepare("UPDATE users SET profile_visibility=?,online_visibility=?,friend_request_setting=?,challenge_setting=?,searchable=?,updated_at=? WHERE id=?").bind(privacy.profileVisibility, privacy.onlineVisibility?1:0, privacy.friendRequestSetting, privacy.challengeSetting, privacy.searchable?1:0, Date.now(), session.user_id).run();
  return ok({ ok: true, settings: next, privacy });
}
function sanitizeSetting(key, value) { if (["sound","animations","premoves","confirmMoves","coordinates"].includes(key)) return Boolean(value); if (key === "boardOrientation") return ["white","black"].includes(value) ? value : "white"; if (key === "boardTheme") return String(value).slice(0,40); if (key === "pieceSet") return String(value).slice(0,40); return value; }
async function settingsForUser(env, userId) { const row = await env.ACCOUNTS.prepare("SELECT settings_json FROM user_settings WHERE user_id=?").bind(userId).first(); try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(row?.settings_json || "{}")) }; } catch { return { ...DEFAULT_SETTINGS }; } }

async function ratingRows(env, userId) { const r = await env.ACCOUNTS.prepare("SELECT category,rating,deviation,games,wins,draws,losses,updated_at FROM ratings WHERE user_id=? ORDER BY CASE category WHEN 'rapid' THEN 1 WHEN 'blitz' THEN 2 WHEN 'bullet' THEN 3 WHEN 'classical' THEN 4 ELSE 5 END").bind(userId).all(); return r.results || []; }
async function getRatings(request, env) {
  const session = await requireAuth(request, env);
  const ratings = await ratingRows(env, session.user_id);
  const history = {};
  for (const category of CATEGORIES) {
    if (category === PUZZLE_CATEGORY) continue;
    const rows = await env.ACCOUNTS.prepare("SELECT rating_before,rating_after,delta,result,created_at FROM rating_history WHERE user_id=? AND category=? ORDER BY created_at ASC LIMIT 120").bind(session.user_id, category).all();
    history[category] = rows.results || [];
  }
  return ok({ ratings, history });
}

async function statsForUser(env, userId) {
  const row = await env.ACCOUNTS.prepare(`SELECT COUNT(*) games, SUM(CASE WHEN (white_user_id=? AND result='white') OR (black_user_id=? AND result='black') THEN 1 ELSE 0 END) wins, SUM(CASE WHEN result='draw' AND (white_user_id=? OR black_user_id=?) THEN 1 ELSE 0 END) draws, SUM(CASE WHEN (white_user_id=? AND result='black') OR (black_user_id=? AND result='white') THEN 1 ELSE 0 END) losses FROM games WHERE white_user_id=? OR black_user_id=?`).bind(userId,userId,userId,userId,userId,userId,userId,userId).first();
  const wins = row?.wins || 0, draws = row?.draws || 0, losses = row?.losses || 0, games = row?.games || 0;
  return { games, wins, draws, losses, winRate: games ? Number(((wins / games) * 100).toFixed(1)) : 0 };
}
async function getStats(request, env) { const session = await requireAuth(request, env); return ok(await statsForUser(env, session.user_id)); }

async function getGames(request, env) {
  const session = await requireAuth(request, env); const url = new URL(request.url); const page = Math.min(Math.max(Number(url.searchParams.get("page") || 1),1),1000); const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20),1),50); const offset=(page-1)*limit; const category=url.searchParams.get("category");
  const query = category && CATEGORIES.includes(category) ? `SELECT g.*, wu.username white_username, bu.username black_username FROM games g LEFT JOIN users wu ON wu.id=g.white_user_id LEFT JOIN users bu ON bu.id=g.black_user_id WHERE (g.white_user_id=? OR g.black_user_id=?) AND g.category=? ORDER BY g.created_at DESC LIMIT ? OFFSET ?` : `SELECT g.*, wu.username white_username, bu.username black_username FROM games g LEFT JOIN users wu ON wu.id=g.white_user_id LEFT JOIN users bu ON bu.id=g.black_user_id WHERE g.white_user_id=? OR g.black_user_id=? ORDER BY g.created_at DESC LIMIT ? OFFSET ?`;
  const bindings = category && CATEGORIES.includes(category) ? [session.user_id,session.user_id,category,limit,offset] : [session.user_id,session.user_id,limit,offset];
  const rows = await env.ACCOUNTS.prepare(query).bind(...bindings).all();
  const raw = rows.results || [];
  const hasMore = raw.length > limit;
  return ok({ page, limit, hasMore, games: raw.slice(0, limit).map(gamePublic) });
}
function gamePublic(g) { return { id:g.id, whiteUserId:g.white_user_id, blackUserId:g.black_user_id, whiteUsername:g.white_username||null, blackUsername:g.black_username||null, category:g.category, timeControl:g.time_control, rated:!!g.rated, result:g.result, reason:g.reason, pgn:g.pgn, createdAt:g.created_at, endedAt:g.ended_at }; }
async function getPuzzleStats(request, env) { const session=await requireAuth(request, env); const s=await env.ACCOUNTS.prepare("SELECT * FROM puzzle_stats WHERE user_id=?").bind(session.user_id).first(); const history=await env.ACCOUNTS.prepare("SELECT rating_after,delta,solved,created_at FROM puzzle_rating_history WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(session.user_id).all(); return ok({ stats:{...s}, history:history.results||[] }); }

async function searchUsers(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  await rateLimit(env, `search:${ip}`, 30, 60);
  const url = new URL(request.url); const q=String(url.searchParams.get("q")||"").trim(); if(q.length<2) return ok({users:[]});
  const session=await currentSession(request, env); const rows=await env.ACCOUNTS.prepare(`SELECT id,username,display_name,avatar_key FROM users WHERE status='active' AND searchable=1 AND username_norm LIKE ? ORDER BY username_norm LIMIT 40`).bind(`${normalizeUsername(q)}%`).all();
  const users=[];
  for (const u of (rows.results||[])) { if (session && await isBlockedEither(env, session.user_id, u.id)) continue; users.push(publicSearchUser(u)); if (users.length>=20) break; }
  return ok({ users });
}
function publicSearchUser(u){return{id:u.id,username:u.username,displayName:u.display_name,avatarUrl:u.avatar_key?`/api/account/avatar/${encodeURIComponent(u.id)}`:null};}

function orderedPair(a,b){return a < b ? [a,b] : [b,a];}
async function areFriends(env,a,b){if(!a||!b||a===b)return false;const [lo,hi]=orderedPair(a,b);const r=await env.ACCOUNTS.prepare("SELECT 1 FROM friendships WHERE user_low=? AND user_high=? AND status='accepted'").bind(lo,hi).first();return!!r;}
async function haveMutualFriend(env, a, b) {
  if (!a || !b || a === b) return false;
  const [aRows, bRows] = await Promise.all([
    env.ACCOUNTS.prepare("SELECT user_low,user_high FROM friendships WHERE status='accepted' AND (user_low=? OR user_high=?)").bind(a, a).all(),
    env.ACCOUNTS.prepare("SELECT user_low,user_high FROM friendships WHERE status='accepted' AND (user_low=? OR user_high=?)").bind(b, b).all()
  ]);
  const aFriends = new Set((aRows.results || []).map(x => x.user_low === a ? x.user_high : x.user_low));
  for (const row of (bRows.results || [])) {
    const friend = row.user_low === b ? row.user_high : row.user_low;
    if (aFriends.has(friend)) return true;
  }
  return false;
}
async function isBlockedEither(env,a,b){if(!a||!b||a===b)return false;const r=await env.ACCOUNTS.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").bind(a,b,b,a).first();return!!r;}

async function getFriends(request, env){
  const s=await requireAuth(request,env);
  const rows=await env.ACCOUNTS.prepare(`SELECT f.*, u.id uid,u.username,u.display_name,u.avatar_key,u.last_seen_at FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low=? THEN f.user_high ELSE f.user_low END WHERE (f.user_low=? OR f.user_high=?) AND f.status='accepted' AND u.status='active' ORDER BY u.username COLLATE NOCASE`).bind(s.user_id,s.user_id,s.user_id).all();
  const incoming=await env.ACCOUNTS.prepare(`SELECT f.requester_id,u.username,u.display_name,u.avatar_key FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.status='pending' AND ((f.user_low=? OR f.user_high=?) AND f.requester_id<>?) ORDER BY f.created_at DESC`).bind(s.user_id,s.user_id,s.user_id).all();
  const outgoing=await env.ACCOUNTS.prepare(`SELECT f.requester_id,u.id uid,u.username,u.display_name,u.avatar_key FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low=? THEN f.user_high ELSE f.user_low END WHERE f.status='pending' AND (f.user_low=? OR f.user_high=?) AND f.requester_id=? ORDER BY f.created_at DESC`).bind(s.user_id,s.user_id,s.user_id,s.user_id).all();
  return ok({friends:rows.results||[],incomingRequests:incoming.results||[],outgoingRequests:outgoing.results||[]});
}
async function friendRequest(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const targetId=String(b.userId||"");if(targetId===s.user_id)throw new Error("cannot_friend_self");if(await isBlockedEither(env,s.user_id,targetId))throw new Error("blocked");const target=await env.ACCOUNTS.prepare("SELECT * FROM users WHERE id=? AND status='active'").bind(targetId).first();if(!target)throw new Error("user_not_found");if(target.friend_request_setting==='nobody')throw new Error("friend_requests_disabled");if(target.friend_request_setting==='friends_of_friends' && !(await areFriends(env,s.user_id,targetId)) && !(await haveMutualFriend(env,s.user_id,targetId)))throw new Error("friend_requests_disabled");const [lo,hi]=orderedPair(s.user_id,targetId);const existing=await env.ACCOUNTS.prepare("SELECT status,requester_id FROM friendships WHERE user_low=? AND user_high=?").bind(lo,hi).first();if(existing?.status==='accepted')throw new Error("already_friends");if(existing?.status==='pending')throw new Error(existing.requester_id===s.user_id?"request_already_sent":"request_already_received");await env.ACCOUNTS.prepare("INSERT INTO friendships VALUES(?,?,?,?,?,?)").bind(lo,hi,s.user_id,'pending',Date.now(),Date.now()).run();await notify(env,targetId,"friend_request",{fromUserId:s.user_id,fromUsername:s.username});return ok({ok:true});}
async function friendRespond(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const requesterId=String(b.userId||"");const [lo,hi]=orderedPair(s.user_id,requesterId);const row=await env.ACCOUNTS.prepare("SELECT * FROM friendships WHERE user_low=? AND user_high=? AND status='pending'").bind(lo,hi).first();if(!row||row.requester_id===s.user_id)throw new Error("friend_request_not_found");const action=b.action==='accept'?'accepted':b.action==='decline'?'declined':null;if(!action)throw new Error("invalid_action");if(action==='accepted'){await env.ACCOUNTS.prepare("UPDATE friendships SET status='accepted',updated_at=? WHERE user_low=? AND user_high=?").bind(Date.now(),lo,hi).run();await notify(env,requesterId,"friend_request_accepted",{fromUserId:s.user_id,fromUsername:s.username});}else{await env.ACCOUNTS.prepare("DELETE FROM friendships WHERE user_low=? AND user_high=?").bind(lo,hi).run();}return ok({ok:true,status:action});}
async function friendRemove(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const other=String(b.userId||"");const [lo,hi]=orderedPair(s.user_id,other);await env.ACCOUNTS.prepare("DELETE FROM friendships WHERE user_low=? AND user_high=?").bind(lo,hi).run();return ok({ok:true});}

async function follow(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const id=String(b.userId||"");if(id===s.user_id)throw new Error("cannot_follow_self");if(await isBlockedEither(env,s.user_id,id))throw new Error("blocked");if(!await env.ACCOUNTS.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(id).first())throw new Error("user_not_found");const existing=await env.ACCOUNTS.prepare("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?").bind(s.user_id,id).first();if(existing)return ok({ok:true,alreadyFollowing:true});await env.ACCOUNTS.prepare("INSERT INTO follows VALUES(?,?,?)").bind(s.user_id,id,Date.now()).run();await notify(env,id,"new_follower",{fromUserId:s.user_id,fromUsername:s.username});return ok({ok:true,alreadyFollowing:false});}
async function unfollow(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);await env.ACCOUNTS.prepare("DELETE FROM follows WHERE follower_id=? AND following_id=?").bind(s.user_id,String(b.userId||"")).run();return ok({ok:true});}
async function block(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const id=String(b.userId||"");if(id===s.user_id)throw new Error("cannot_block_self");if(!await env.ACCOUNTS.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(id).first())throw new Error("user_not_found");const [lo,hi]=orderedPair(s.user_id,id);await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("INSERT OR IGNORE INTO blocks VALUES(?,?,?)").bind(s.user_id,id,Date.now()),env.ACCOUNTS.prepare("DELETE FROM friendships WHERE user_low=? AND user_high=?").bind(lo,hi),env.ACCOUNTS.prepare("DELETE FROM follows WHERE (follower_id=? AND following_id=?) OR (follower_id=? AND following_id=?)").bind(s.user_id,id,id,s.user_id),env.ACCOUNTS.prepare("UPDATE challenges SET status='cancelled',updated_at=? WHERE status='pending' AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))").bind(Date.now(),s.user_id,id,id,s.user_id)]);return ok({ok:true});}
async function unblock(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);await env.ACCOUNTS.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").bind(s.user_id,String(b.userId||"")).run();return ok({ok:true});}
async function report(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const userId=String(b.userId||"");const category=String(b.category||"other").slice(0,50);const allowed=new Set(["other","abuse","harassment","spam","cheating"]);if(!allowed.has(category))throw new Error("invalid_report_category");const details=String(b.details||"").slice(0,2000);if(userId===s.user_id)throw new Error("cannot_report_self");if(!await userById(env,userId))throw new Error("user_not_found");await rateLimit(env,`report:${s.user_id}`,10,86400);await env.ACCOUNTS.prepare("INSERT INTO reports(id,reporter_id,reported_user_id,category,details,created_at) VALUES(?,?,?,?,?,?)").bind(randomId(),s.user_id,userId,category,details,Date.now()).run();return ok({ok:true});}

async function notify(env,userId,type,payload){await env.ACCOUNTS.prepare("INSERT INTO notifications(id,user_id,type,payload_json,created_at) VALUES(?,?,?,?,?)").bind(randomId(),userId,type,JSON.stringify(payload||{}),Date.now()).run();}
async function notifications(request,env){const s=await requireAuth(request,env);const rows=await env.ACCOUNTS.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(s.user_id).all();return ok({notifications:(rows.results||[]).map(n=>({id:n.id,type:n.type,payload:JSON.parse(n.payload_json||'{}'),createdAt:n.created_at,readAt:n.read_at}))});}
async function markNotificationsRead(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);if(b.all)await env.ACCOUNTS.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").bind(Date.now(),s.user_id).run();else if(Array.isArray(b.ids)&&b.ids.length)for(const id of b.ids.slice(0,100))await env.ACCOUNTS.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?").bind(Date.now(),String(id),s.user_id).run();return ok({ok:true});}

function parseTimeControl(value){
  const m=String(value||"").trim().match(/^(\d{1,4})\+(\d{1,4})$/);
  if(!m)return null;
  const minutes=Number(m[1]), increment=Number(m[2]);
  if(!Number.isSafeInteger(minutes)||!Number.isSafeInteger(increment)||minutes<0||minutes>1440||increment<0||increment>3600)return null;
  const initial=minutes*60;
  if(initial===0 && increment!==0)return null;
  if(initial!==0 && initial<60)return null;
  return {minutes,initial,increment,label:`${minutes}+${increment}`};
}
function categoryForTime(initial){if(initial < 180)return 'bullet';if(initial < 600)return 'blitz';if(initial <= 1800)return 'rapid';return 'classical';}

async function createChallenge(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const recipient=String(b.recipientId||"");if(b.rematchOf){const source=await env.ACCOUNTS.prepare("SELECT sender_id,recipient_id,status FROM challenges WHERE id=?").bind(String(b.rematchOf)).first();if(!source || source.status!=="accepted" || ![source.sender_id,source.recipient_id].includes(s.user_id))throw new Error("invalid_rematch");const expectedRecipient=source.sender_id===s.user_id?source.recipient_id:source.sender_id;if(recipient!==expectedRecipient)throw new Error("invalid_rematch");}if(recipient===s.user_id)throw new Error("cannot_challenge_self");if(await isBlockedEither(env,s.user_id,recipient))throw new Error("blocked");const u=await env.ACCOUNTS.prepare("SELECT * FROM users WHERE id=? AND status='active'").bind(recipient).first();if(!u)throw new Error("user_not_found");if(u.challenge_setting==='nobody'||(u.challenge_setting==='friends'&&!await areFriends(env,s.user_id,recipient)))throw new Error("challenges_disabled");const parsed=parseTimeControl(b.timeControl||"10+0");if(!parsed)throw new Error("invalid_time_control");const category=CATEGORIES.includes(b.category)?b.category:categoryForTime(parsed.initial);if(category!==categoryForTime(parsed.initial))throw new Error("time_control_category_mismatch");const existing=await env.ACCOUNTS.prepare("SELECT id FROM challenges WHERE sender_id=? AND recipient_id=? AND status='pending' AND expires_at>? LIMIT 1").bind(s.user_id,recipient,Date.now()).first();if(existing)throw new Error("challenge_already_pending");const timeControl=parsed.label;const rated=Boolean(b.rated);const now=Date.now();const id=randomId();await env.ACCOUNTS.prepare("INSERT INTO challenges(id,sender_id,recipient_id,time_control,category,rated,status,rematch_of,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,s.user_id,recipient,timeControl,category,rated?1:0,'pending',b.rematchOf?String(b.rematchOf):null,now,now+10*60000,now).run();await notify(env,recipient,'challenge',{challengeId:id,fromUserId:s.user_id,fromUsername:s.username,category,timeControl,rated});return ok({ok:true,challengeId:id});}
async function getChallenges(request,env){const s=await requireAuth(request,env);const now=Date.now();await env.ACCOUNTS.prepare("UPDATE challenges SET status='expired',updated_at=? WHERE status='pending' AND expires_at<=? AND (sender_id=? OR recipient_id=?)").bind(now,now,s.user_id,s.user_id).run();const rows=await env.ACCOUNTS.prepare(`SELECT c.*, su.username sender_username, ru.username recipient_username FROM challenges c JOIN users su ON su.id=c.sender_id JOIN users ru ON ru.id=c.recipient_id WHERE c.sender_id=? OR c.recipient_id=? ORDER BY c.created_at DESC LIMIT 100`).bind(s.user_id,s.user_id).all();return ok({challenges:rows.results||[]});}
async function challengeRespond(request, env) {
  const s = await requireAuth(request, env);
  await requireCsrf(request, s);
  const b = await bodyJson(request);
  const c = await env.ACCOUNTS.prepare("SELECT * FROM challenges WHERE id=?").bind(String(b.challengeId || "")).first();
  if (!c || c.recipient_id !== s.user_id) throw new Error("challenge_not_found");
  if (await isBlockedEither(env, s.user_id, c.sender_id)) throw new Error("blocked");
  const action = b.action === "accept" ? "accepted" : b.action === "decline" ? "declined" : null;
  if (!action) throw new Error("invalid_action");
  const now = Date.now();
  if (c.status !== "pending" || now > c.expires_at) throw new Error("challenge_expired");
  const result = await env.ACCOUNTS.prepare("UPDATE challenges SET status=?,updated_at=? WHERE id=? AND status='pending' AND expires_at>?")
    .bind(action, now, c.id, now).run();
  if (!result?.meta?.changes) throw new Error("challenge_expired");
  await notify(env, c.sender_id, "challenge_response", { challengeId: c.id, status: action, fromUserId: s.user_id, fromUsername: s.username });
  return ok({ ok: true, status: action });
}

async function leaderboard(request,env){const url=new URL(request.url);const rawCategory=url.searchParams.get('category'); const category=[...CATEGORIES,PUZZLE_CATEGORY].includes(rawCategory)?rawCategory:'rapid'; if(category===PUZZLE_CATEGORY){const rows=await env.ACCOUNTS.prepare(`SELECT p.rating,p.games,u.id,u.username,u.display_name,u.avatar_key FROM puzzle_stats p JOIN users u ON u.id=p.user_id WHERE u.status='active' AND u.searchable=1 ORDER BY p.rating DESC,p.games DESC LIMIT 100`).all();return ok({category,players:(rows.results||[]).map((r,i)=>({rank:i+1,userId:r.id,username:r.username,displayName:r.display_name,avatarUrl:r.avatar_key?`/api/account/avatar/${encodeURIComponent(r.id)}`:null,rating:r.rating,games:r.games}))});}const rows=await env.ACCOUNTS.prepare(`SELECT r.rating,r.games,u.id,u.username,u.display_name,u.avatar_key FROM ratings r JOIN users u ON u.id=r.user_id WHERE r.category=? AND u.status='active' AND u.searchable=1 ORDER BY r.rating DESC,r.games DESC LIMIT 100`).bind(category).all();return ok({category,players:(rows.results||[]).map((r,i)=>({rank:i+1,userId:r.id,username:r.username,displayName:r.display_name,avatarUrl:r.avatar_key?`/api/account/avatar/${encodeURIComponent(r.id)}`:null,rating:r.rating,games:r.games}))});}
async function getBadges(request,env){const s=await requireAuth(request,env);const rows=await env.ACCOUNTS.prepare("SELECT code,awarded_at FROM badges WHERE user_id=? ORDER BY awarded_at DESC").bind(s.user_id).all();return ok({badges:rows.results||[]});}

async function listSessions(request,env){const s=await requireAuth(request,env);const rows=await env.ACCOUNTS.prepare("SELECT id,created_at,last_seen_at,expires_at,user_agent FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC").bind(s.user_id).all();return ok({sessions:(rows.results||[]).map(x=>({id:x.id,createdAt:x.created_at,lastSeenAt:x.last_seen_at,expiresAt:x.expires_at,userAgent:x.user_agent,isCurrent:x.id===s.id}))});}
async function revokeSession(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);if(String(b.sessionId||"")===s.id)throw new Error("cannot_revoke_current_session");await env.ACCOUNTS.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").bind(String(b.sessionId||""),s.user_id).run();return ok({ok:true});}
async function revokeAllOtherSessions(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);await env.ACCOUNTS.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(s.user_id,s.id).run();return ok({ok:true});}
async function changePassword(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);if(!s.password_hash)throw new Error("password_login_not_enabled");const b=await bodyJson(request);if(!(await passwordVerify(String(b.currentPassword||""),s.password_hash,env.PASSWORD_PEPPER||"")))throw new Error("invalid_credentials");if(String(b.newPassword||"").length<8)throw new Error("invalid_password");const newHash=await passwordHash(String(b.newPassword),env.PASSWORD_PEPPER||"");await env.ACCOUNTS.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").bind(newHash,Date.now(),s.user_id).run();await env.ACCOUNTS.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(s.user_id,s.id).run();return ok({ok:true});}

async function setup2FA(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);if(s.two_factor_enabled)throw new Error("2fa_already_enabled");const secret=randomBase32(20);const encrypted=await encryptText(secret,env.ACCOUNT_ENCRYPTION_KEY);await env.ACCOUNTS.prepare("UPDATE users SET two_factor_secret_enc=?,two_factor_last_step=NULL,updated_at=? WHERE id=?").bind(encrypted,Date.now(),s.user_id).run();const uri=otpauthUri({issuer:'Advanced Chess',accountName:s.email||s.username,secret});return ok({ok:true,secret,otpauthUri:uri,message:'Enter the secret in an authenticator app, then verify the code to enable 2FA.'});}
async function verify2FA(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);if(!s.two_factor_secret_enc)throw new Error('2fa_setup_required');const secret=await decryptText(s.two_factor_secret_enc,env.ACCOUNT_ENCRYPTION_KEY);const matchedStep=await matchingTotpStep(secret,b.code);if(matchedStep===null)throw new Error('invalid_2fa_code');if(Number(s.two_factor_last_step??-1)>=matchedStep)throw new Error('invalid_2fa_code');const codes=generateBackupCodes();const now=Date.now();const rows=[];for(const code of codes)rows.push(env.ACCOUNTS.prepare("INSERT INTO two_factor_backup_codes(id,user_id,code_hash,created_at) VALUES(?,?,?,?)").bind(randomId(),s.user_id,await sha256Hex(code),now));rows.push(env.ACCOUNTS.prepare("UPDATE users SET two_factor_enabled=1,two_factor_last_step=?,updated_at=? WHERE id=? AND (two_factor_last_step IS NULL OR two_factor_last_step<?)").bind(matchedStep,now,s.user_id,matchedStep));await env.ACCOUNTS.batch(rows);return ok({ok:true,backupCodes:codes});}
async function disable2FA(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);if(!(await verifyUser2FACode(env,s,b.code)))throw new Error('invalid_2fa_code');await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("UPDATE users SET two_factor_enabled=0,two_factor_secret_enc=NULL,two_factor_last_step=NULL,updated_at=? WHERE id=?").bind(Date.now(),s.user_id),env.ACCOUNTS.prepare("DELETE FROM two_factor_backup_codes WHERE user_id=?").bind(s.user_id)]);return ok({ok:true});}

async function consumeEmailToken(env, token, expectedKind) {
  const row = await env.ACCOUNTS.prepare("SELECT * FROM email_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>? ").bind(await sha256Hex(token), expectedKind, Date.now()).first();
  if (!row) throw new Error("invalid_verification_token");
  return row;
}

async function verifyEmail(request,env){
  const b=await bodyJson(request);
  const row=await consumeEmailToken(env,String(b.token||""),"verify_email");
  await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("UPDATE users SET email_verified=1,updated_at=? WHERE id=?").bind(Date.now(),row.user_id),env.ACCOUNTS.prepare("UPDATE email_tokens SET used_at=? WHERE id=?").bind(Date.now(),row.id)]);
  return ok({ok:true});
}

async function verifyEmailChange(request,env){
  const b=await bodyJson(request);
  const row=await consumeEmailToken(env,String(b.token||""),"email_change");
  const meta=JSON.parse(row.meta_json||"{}");
  const email=normalizeEmail(meta.email);
  if(!email)throw new Error("invalid_email");
  if(await env.ACCOUNTS.prepare("SELECT id FROM users WHERE email_norm=? AND id<>?").bind(email,row.user_id).first())throw new Error("email_taken");
  await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("UPDATE users SET email=?,email_norm=?,email_verified=1,updated_at=? WHERE id=?").bind(email,email,Date.now(),row.user_id),env.ACCOUNTS.prepare("UPDATE email_tokens SET used_at=? WHERE id=?").bind(Date.now(),row.id),env.ACCOUNTS.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.user_id)]);
  return responseWithCookies({ok:true},[clearCookie(SESSION_COOKIE),clearCookie(CSRF_COOKIE)]);
}

async function resendVerification(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);if(s.email_verified)return ok({ok:true,alreadyVerified:true});if(!s.email)throw new Error('email_not_configured');await rateLimit(env,`verify:${s.user_id}`,3,60);const now=Date.now();const token=randomToken(32);await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("DELETE FROM email_tokens WHERE user_id=? AND kind='verify_email' AND used_at IS NULL").bind(s.user_id),env.ACCOUNTS.prepare("INSERT INTO email_tokens(id,user_id,kind,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)").bind(randomId(),s.user_id,'verify_email',await sha256Hex(token),now,now+VERIFY_HOURS*3600000)]);const tpl=emailVerificationTemplate({username:s.username,link:emailLink(env,'/account/index.html#verify-email',token)});await sendTransactionalEmail(env,{to:s.email,...tpl});return ok({ok:true});}
async function forgotPassword(request,env){const body=await bodyJson(request);const email=normalizeEmail(body.email);const start=Date.now();await rateLimit(env,`forgot:${email}`,3,60);const user=await env.ACCOUNTS.prepare("SELECT id,username,email FROM users WHERE email_norm=? AND status='active'").bind(email).first();if(user){const token=randomToken(32);await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("DELETE FROM email_tokens WHERE user_id=? AND kind='password_reset' AND used_at IS NULL").bind(user.id),env.ACCOUNTS.prepare("INSERT INTO email_tokens(id,user_id,kind,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)").bind(randomId(),user.id,'password_reset',await sha256Hex(token),start,start+RESET_MINUTES*60000)]);const tpl=passwordResetTemplate({username:user.username,link:emailLink(env,'/account/index.html#reset-password',token)});try{await sendTransactionalEmail(env,{to:user.email,...tpl});}catch(e){if(e.message!=='email_not_configured')throw e;}}await new Promise(r=>setTimeout(r,Math.max(0,250-(Date.now()-start))));return ok({ok:true,message:'If that account exists, a reset link has been sent.'});}
async function resetPassword(request,env){const b=await bodyJson(request);const token=String(b.token||"");if(String(b.password||"").length<8)throw new Error('invalid_password');const row=await env.ACCOUNTS.prepare("SELECT * FROM email_tokens WHERE token_hash=? AND kind='password_reset' AND used_at IS NULL AND expires_at>?").bind(await sha256Hex(token),Date.now()).first();if(!row)throw new Error('invalid_reset_token');const hash=await passwordHash(String(b.password),env.PASSWORD_PEPPER||'');await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").bind(hash,Date.now(),row.user_id),env.ACCOUNTS.prepare("UPDATE email_tokens SET used_at=? WHERE id=?").bind(Date.now(),row.id),env.ACCOUNTS.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.user_id)]);return ok({ok:true});}
async function requestEmailChange(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const email=normalizeEmail(b.email);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('invalid_email');if(await env.ACCOUNTS.prepare("SELECT id FROM users WHERE email_norm=? AND id<>?").bind(email,s.user_id).first())throw new Error('email_taken');if(s.password_hash&&!await passwordVerify(String(b.password||''),s.password_hash,env.PASSWORD_PEPPER||''))throw new Error('invalid_credentials');const token=randomToken(32);const now=Date.now();await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("DELETE FROM email_tokens WHERE user_id=? AND kind='email_change' AND used_at IS NULL").bind(s.user_id),env.ACCOUNTS.prepare("INSERT INTO email_tokens(id,user_id,kind,token_hash,meta_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)").bind(randomId(),s.user_id,'email_change',await sha256Hex(token),JSON.stringify({email}),now,now+VERIFY_HOURS*3600000)]);const tpl=emailVerificationTemplate({username:s.username,link:emailLink(env,'/account/index.html#verify-email-change',token)});await sendTransactionalEmail(env,{to:email,...tpl});return ok({ok:true});}

async function exportData(request,env){const s=await requireAuth(request,env);const user=await userById(env,s.user_id);const [ratings,games,friendships,follows,notifications,challenges,badges,settings,puzzles,puzzleHistory]=await Promise.all([env.ACCOUNTS.prepare("SELECT * FROM ratings WHERE user_id=?").bind(s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM games WHERE white_user_id=? OR black_user_id=? ORDER BY created_at DESC").bind(s.user_id,s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM friendships WHERE user_low=? OR user_high=?").bind(s.user_id,s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM follows WHERE follower_id=? OR following_id=?").bind(s.user_id,s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM notifications WHERE user_id=?").bind(s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM challenges WHERE sender_id=? OR recipient_id=?").bind(s.user_id,s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM badges WHERE user_id=?").bind(s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM user_settings WHERE user_id=?").bind(s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM puzzle_stats WHERE user_id=?").bind(s.user_id).all(),env.ACCOUNTS.prepare("SELECT * FROM puzzle_rating_history WHERE user_id=?").bind(s.user_id).all()]);const ratingHistory=await Promise.all(CATEGORIES.filter(c=>c!=='puzzle').map(async category=>({category,rows:(await env.ACCOUNTS.prepare("SELECT * FROM rating_history WHERE user_id=? AND category=? ORDER BY created_at ASC").bind(s.user_id,category).all()).results||[]})));
const payload={exportedAt:new Date().toISOString(),user:publicUser(user),ratings:ratings.results||[],ratingHistory,games:(games.results||[]).map(gamePublic),friendships:friendships.results||[],follows:follows.results||[],notifications:notifications.results||[],challenges:challenges.results||[],badges:badges.results||[],settings:settings.results||[],puzzles:puzzles.results||[],puzzleHistory:puzzleHistory.results||[]};return new Response(JSON.stringify(payload,null,2),{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="advanced-chess-${s.username}-data.json"`,'cache-control':'no-store'}});}

async function deleteAccount(request,env){
  const s=await requireAuth(request,env); await requireCsrf(request,s);
  const b=await bodyJson(request);
  if(String(b.username||"")!==s.username)throw new Error("confirmation_required");
  if(s.password_hash&&!await passwordVerify(String(b.password||""),s.password_hash,env.PASSWORD_PEPPER||""))throw new Error("invalid_credentials");
  if(s.two_factor_enabled && !(await verifyUser2FACode(env,s,b.twoFactorCode))) throw new Error("invalid_2fa_code");
  const current=await env.ACCOUNTS.prepare("SELECT avatar_key FROM users WHERE id=?").bind(s.user_id).first();
  const id=s.user_id;
  const statements=[
    env.ACCOUNTS.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM auth_identities WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM email_tokens WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM ratings WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM rating_history WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM puzzle_stats WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM puzzle_rating_history WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("UPDATE games SET white_user_id=NULL WHERE white_user_id=?").bind(id),
    env.ACCOUNTS.prepare("UPDATE games SET black_user_id=NULL WHERE black_user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM friendships WHERE user_low=? OR user_high=?").bind(id,id),
    env.ACCOUNTS.prepare("DELETE FROM follows WHERE follower_id=? OR following_id=?").bind(id,id),
    env.ACCOUNTS.prepare("DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?").bind(id,id),
    env.ACCOUNTS.prepare("DELETE FROM reports WHERE reporter_id=? OR reported_user_id=?").bind(id,id),
    env.ACCOUNTS.prepare("DELETE FROM challenges WHERE sender_id=? OR recipient_id=?").bind(id,id),
    env.ACCOUNTS.prepare("DELETE FROM notifications WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM badges WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM two_factor_backup_codes WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM user_settings WHERE user_id=?").bind(id),
    env.ACCOUNTS.prepare("DELETE FROM users WHERE id=?").bind(id)
  ];
  await env.ACCOUNTS.batch(statements);
  return responseWithCookies({ok:true,deleted:true},[clearCookie(SESSION_COOKIE),clearCookie(CSRF_COOKIE),clearCookie(GUEST_COOKIE)]);
}

async function verifyInternalSecret(request, env) {
  const secret = request.headers.get('X-Account-Internal-Secret') || '';
  if (!env.ACCOUNT_INTERNAL_SECRET || !constantEqual(secret, env.ACCOUNT_INTERNAL_SECRET)) throw new Error('forbidden');
}

async function internalGameResult(request, env) {
  await verifyInternalSecret(request, env);
  const b = await bodyJson(request);
  return ok(await applyGameResult(env, b));
}

function buildEloStatements(env, { gameId, category, white, black, result, now }) {
  return Promise.all([
    env.ACCOUNTS.prepare("SELECT * FROM ratings WHERE user_id=? AND category=?").bind(white, category).first(),
    env.ACCOUNTS.prepare("SELECT * FROM ratings WHERE user_id=? AND category=?").bind(black, category).first()
  ]).then(([wr, br]) => {
    if (!wr || !br) throw new Error("ratings_not_initialized");
    const whiteScore = result === "white" ? 1 : result === "draw" ? 0.5 : 0;
    const blackScore = 1 - whiteScore;
    const whiteDelta = eloDelta(wr.rating, br.rating, whiteScore, wr.games);
    const blackDelta = eloDelta(br.rating, wr.rating, blackScore, br.games);
    const stamp = now || Date.now();
    const whiteAfter = wr.rating + whiteDelta;
    const blackAfter = br.rating + blackDelta;
    return [
      env.ACCOUNTS.prepare("UPDATE ratings SET rating=?,games=games+1,wins=wins+?,draws=draws+?,losses=losses+?,updated_at=? WHERE user_id=? AND category=?")
        .bind(whiteAfter, whiteScore === 1 ? 1 : 0, whiteScore === 0.5 ? 1 : 0, whiteScore === 0 ? 1 : 0, stamp, white, category),
      env.ACCOUNTS.prepare("INSERT INTO rating_history(id,user_id,category,game_id,rating_before,rating_after,delta,result,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(randomId(), white, category, gameId, wr.rating, whiteAfter, whiteDelta, whiteScore === 1 ? "win" : whiteScore === 0.5 ? "draw" : "loss", stamp),
      env.ACCOUNTS.prepare("UPDATE ratings SET rating=?,games=games+1,wins=wins+?,draws=draws+?,losses=losses+?,updated_at=? WHERE user_id=? AND category=?")
        .bind(blackAfter, blackScore === 1 ? 1 : 0, blackScore === 0.5 ? 1 : 0, blackScore === 0 ? 1 : 0, stamp, black, category),
      env.ACCOUNTS.prepare("INSERT INTO rating_history(id,user_id,category,game_id,rating_before,rating_after,delta,result,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(randomId(), black, category, gameId, br.rating, blackAfter, blackDelta, blackScore === 1 ? "win" : blackScore === 0.5 ? "draw" : "loss", stamp)
    ];
  });
}

async function applyGameResult(env, b) {
  const gameId = String(b.gameId || "").trim();
  if (!gameId || gameId.length > 120) throw new Error("game_id_required");
  if (await env.ACCOUNTS.prepare("SELECT id FROM games WHERE id=?").bind(gameId).first()) return { ok: true, duplicate: true };

  const white = b.whiteUserId ? String(b.whiteUserId) : null;
  const black = b.blackUserId ? String(b.blackUserId) : null;
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  if (!category) throw new Error("invalid_category");
  const result = ["white", "black", "draw", "aborted", "unfinished"].includes(b.result) ? b.result : null;
  if (!result) throw new Error("invalid_result");
  if (white && black && white === black) throw new Error("invalid_players");

  if (white && !(await userById(env, white))) throw new Error("white_user_not_found");
  if (black && !(await userById(env, black))) throw new Error("black_user_not_found");
  const parsed = parseTimeControl(b.timeControl || "");
  if (!parsed) throw new Error("invalid_time_control");
  if (category !== categoryForTime(parsed.initial)) throw new Error("time_control_category_mismatch");

  const now = Date.now();
  let eloStatements = [];
  if (b.rated && white && black && ["white", "black", "draw"].includes(result)) {
    eloStatements = await buildEloStatements(env, { gameId, category, white, black, result, now });
  }

  const gameInsert = env.ACCOUNTS.prepare("INSERT INTO games(id,white_user_id,black_user_id,category,time_control,rated,result,reason,pgn,created_at,ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(gameId, white, black, category, parsed.label, b.rated ? 1 : 0, result, String(b.reason || "").slice(0, 80), String(b.pgn || "").slice(0, 200000), Number(b.createdAt) || now, Number(b.endedAt) || now);
  await env.ACCOUNTS.batch([gameInsert, ...eloStatements]);
  if (white) await awardBadges(env, white);
  if (black) await awardBadges(env, black);
  return { ok: true };
}

function expectedScore(r1,r2){return 1/(1+10**((r2-r1)/400));}
function eloDelta(r1,r2,score,games){const k=games<30?40:20;return Math.round(k*(score-expectedScore(r1,r2)));}


async function internalPuzzleResult(request,env){await verifyInternalSecret(request,env);const b=await bodyJson(request);const userId=String(b.userId||'');const solved=Boolean(b.solved);if(!userId)throw new Error('user_id_required');const row=await env.ACCOUNTS.prepare("SELECT * FROM puzzle_stats WHERE user_id=?").bind(userId).first();if(!row)throw new Error('user_not_found');const expected=expectedScore(row.rating,Number(b.puzzleRating)||row.rating);const delta=Math.round(20*((solved?1:0)-expected));const newRating=Math.max(100,row.rating+delta);const streak=solved?row.streak+1:0;const best=Math.max(row.best_streak,streak);const now=Date.now();await env.ACCOUNTS.batch([env.ACCOUNTS.prepare("UPDATE puzzle_stats SET rating=?,games=games+1,solves=solves+?,streak=?,best_streak=?,updated_at=? WHERE user_id=?").bind(newRating,solved?1:0,streak,best,now,userId),env.ACCOUNTS.prepare("INSERT INTO puzzle_rating_history(id,user_id,rating_before,rating_after,delta,solved,created_at) VALUES(?,?,?,?,?,?,?)").bind(randomId(),userId,row.rating,newRating,delta,solved?1:0,now)]);await awardBadges(env,userId);return ok({ok:true,rating:newRating,delta,streak,bestStreak:best});}

async function internalGuestGameResult(request, env) {
  await verifyInternalSecret(request, env);
  const b = await bodyJson(request);
  const guestId = String(b.guestId || "");
  if (!guestId) throw new Error("guest_id_required");
  const guest = await env.ACCOUNTS.prepare("SELECT * FROM guest_accounts WHERE id=?").bind(guestId).first();
  if (!guest) throw new Error("guest_not_found");
  const result = ["white","black","draw","aborted","unfinished"].includes(b.result) ? b.result : null;
  if (!result) throw new Error("invalid_result");
  const guestColor = ["w","b"].includes(b.guestColor) ? b.guestColor : null;
  if (!guestColor) throw new Error("guest_color_required");
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  if (!category) throw new Error("invalid_category");
  const parsed = parseTimeControl(b.timeControl || "");
  if (!parsed || category !== categoryForTime(parsed.initial)) throw new Error("invalid_time_control");
  const now = Date.now(); let data={}; try{data=JSON.parse(guest.data_json||"{}")}catch{}
  data.ratings=data.ratings||{}; data.games=Array.isArray(data.games)?data.games:[];
  const current=data.ratings[category]||{rating:1200,games:0,wins:0,draws:0,losses:0};
  const score=result==='draw'?0.5:((guestColor==='w'&&result==='white')||(guestColor==='b'&&result==='black'))?1:0;
  const opponentRating=Number(b.opponentRating)||1200;
  const delta=(["white","black","draw"].includes(result)&&b.rated!==false)?eloDelta(Number(current.rating)||1200,opponentRating,score,Number(current.games)||0):0;
  const updated={rating:Math.max(100,(Number(current.rating)||1200)+delta),games:(Number(current.games)||0)+1,wins:(Number(current.wins)||0)+(score===1?1:0),draws:(Number(current.draws)||0)+(score===0.5?1:0),losses:(Number(current.losses)||0)+(score===0?1:0)};
  data.ratings[category]=updated;
  const gameId = String(b.gameId || randomId());
  if (data.games.some(g => String(g?.id || "") === gameId)) return ok({ok:true,duplicate:true,rating:Number(updated.rating)||1200,delta:0});
  data.games.unshift({id:gameId,category,timeControl:parsed.label,rated:Boolean(b.rated),result,reason:String(b.reason||"").slice(0,80),pgn:String(b.pgn||"").slice(0,200000),createdAt:Number(b.createdAt)||now,endedAt:Number(b.endedAt)||now});
  data.games=data.games.slice(0,500);
  await env.ACCOUNTS.prepare("UPDATE guest_accounts SET data_json=?,last_seen_at=? WHERE id=?").bind(JSON.stringify(data),now,guestId).run();
  return ok({ok:true,rating:updated.rating,delta});
}

async function internalGuestPuzzleResult(request, env) {
  await verifyInternalSecret(request, env);
  const b = await bodyJson(request); const guestId=String(b.guestId||""); if(!guestId)throw new Error("guest_id_required");
  const guest=await env.ACCOUNTS.prepare("SELECT * FROM guest_accounts WHERE id=?").bind(guestId).first(); if(!guest)throw new Error("guest_not_found");
  const solved=Boolean(b.solved); const now=Date.now(); let data={}; try{data=JSON.parse(guest.data_json||"{}")}catch{}; const current=data.puzzles||{rating:1200,games:0,solves:0,streak:0,bestStreak:0};
  const expected=expectedScore(Number(current.rating)||1200,Number(b.puzzleRating)||Number(current.rating)||1200); const delta=Math.round(20*((solved?1:0)-expected)); const rating=Math.max(100,(Number(current.rating)||1200)+delta); const streak=solved?(Number(current.streak)||0)+1:0; const best=Math.max(Number(current.bestStreak)||0,streak); data.puzzles={rating,games:(Number(current.games)||0)+1,solves:(Number(current.solves)||0)+(solved?1:0),streak,bestStreak:best};
  await env.ACCOUNTS.prepare("UPDATE guest_accounts SET data_json=?,last_seen_at=? WHERE id=?").bind(JSON.stringify(data),now,guestId).run(); return ok({ok:true,rating,delta,streak,bestStreak:best});
}


async function awardBadges(env,userId){const stats=await statsForUser(env,userId);const ratings=await env.ACCOUNTS.prepare("SELECT category,rating,games FROM ratings WHERE user_id=?").bind(userId).all();const rows=ratings.results||[];const candidates=[];if(stats.games>=100)candidates.push('games_100');if(stats.wins>=10&&stats.games>0)candidates.push('wins_10');if(stats.wins>=50)candidates.push('wins_50');const puzzle=await env.ACCOUNTS.prepare("SELECT * FROM puzzle_stats WHERE user_id=?").bind(userId).first();if((puzzle?.solves||0)>=100)candidates.push('puzzle_100');if((puzzle?.best_streak||0)>=10)candidates.push('puzzle_streak_10');for(const row of rows)if(row.rating>=1500)candidates.push(`${row.category}_1500`);for(const code of new Set(candidates))await env.ACCOUNTS.prepare("INSERT OR IGNORE INTO badges(user_id,code,awarded_at) VALUES(?,?,?)").bind(userId,code,Date.now()).run();}

async function listTournaments(request,env){const rows=await env.ACCOUNTS.prepare("SELECT * FROM tournaments WHERE status<>'cancelled' ORDER BY starts_at ASC LIMIT 50").all();return ok({tournaments:rows.results||[]});}
async function joinTournament(request,env){const s=await requireAuth(request,env);await requireCsrf(request,s);const b=await bodyJson(request);const id=String(b.tournamentId||'');const t=await env.ACCOUNTS.prepare("SELECT * FROM tournaments WHERE id=? AND status IN ('scheduled','live')").bind(id).first();if(!t)throw new Error('tournament_not_found');if(Number(t.starts_at)>Date.now()+365*86400000)throw new Error('tournament_invalid');const count=await env.ACCOUNTS.prepare("SELECT COUNT(*) c FROM tournament_entries WHERE tournament_id=?").bind(id).first();const already=await env.ACCOUNTS.prepare("SELECT 1 FROM tournament_entries WHERE tournament_id=? AND user_id=?").bind(id,s.user_id).first();if(!already&&Number(count?.c||0)>=t.max_players)throw new Error('tournament_full');await env.ACCOUNTS.prepare("INSERT OR IGNORE INTO tournament_entries(tournament_id,user_id,joined_at) VALUES(?,?,?)").bind(id,s.user_id,Date.now()).run();return ok({ok:true,alreadyJoined:!!already});}
async function tournamentStandings(request,env){const url=new URL(request.url);const id=String(url.searchParams.get('id')||'');const rows=await env.ACCOUNTS.prepare(`SELECT e.*,u.username,u.display_name,u.avatar_key FROM tournament_entries e JOIN users u ON u.id=e.user_id WHERE e.tournament_id=? ORDER BY e.score DESC,e.wins DESC,e.games ASC LIMIT 256`).bind(id).all();return ok({standings:(rows.results||[]).map((r,i)=>({rank:i+1,...r,avatarUrl:r.avatar_key?`/api/account/avatar/${encodeURIComponent(r.user_id)}`:null}))});}

async function userById(env,id){return env.ACCOUNTS.prepare("SELECT * FROM users WHERE id=? AND status='active'").bind(id).first();}
function publicUser(u,self=false){if(!u)return null;const base={id:u.id,username:u.username,displayName:u.display_name,about:u.about||'',country:u.country||null,timezone:u.timezone||null,avatarUrl:u.avatar_key?`/api/account/avatar/${encodeURIComponent(u.id)}`:null,profileVisibility:u.profile_visibility,onlineVisibility:!!u.online_visibility,createdAt:u.created_at,lastSeenAt:u.online_visibility?u.last_seen_at:null,isSelf:self};if(self){base.email=u.email||null;base.emailVerified=!!u.email_verified;base.passwordLoginEnabled=!!u.password_hash;base.friendRequestSetting=u.friend_request_setting;base.challengeSetting=u.challenge_setting;base.searchable=!!u.searchable;base.twoFactorEnabled=!!u.two_factor_enabled;}return base;}

export { expectedScore, eloDelta, normalizeUsername, validateUsername, publicUser };
