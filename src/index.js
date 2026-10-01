import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";
import { handleAccountRequest, resolvePlayerIdentity, recordCompletedGame } from "./account/account.js";
import {
  buildExplorerRequest,
  identifyOpening,
  mergeExplorerResponses,
  normalizeExplorerResponse,
  openingSearchResults,
  normalizeSearchQuery,
  validateExplorerParams,
} from "./openings.js";

const PROTOCOL = 1;
const GAME_ID_RE = /^[A-Z0-9]{8,16}$/;
const NAME_MAX = 24;
const MAX_MESSAGE = 16 * 1024;
const TOKEN_BYTES = 32;
const GAME_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_INITIAL_MS = 15_000;
const MAX_INITIAL_MS = 24 * 60 * 60 * 1000;
const MAX_INCREMENT_MS = 60 * 60 * 1000;
const OPENING_CATALOG_CACHE_TTL = 24 * 60 * 60;
const OPENING_EXPLORER_CACHE_TTL = 15 * 60;
const openingCatalogMemory = { value: null, promise: null };
const openingExplorerInFlight = new Map();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function randomBytes(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return a;
}

function base64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  return base64Url(randomBytes(TOKEN_BYTES));
}

function randomGameId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[b[i] % alphabet.length];
  return out;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeName(name) {
  const value = typeof name === "string" ? name.trim().replace(/[\u0000-\u001F\u007F]/g, "") : "";
  return value.slice(0, NAME_MAX) || "Anonymous";
}

function normalizeTimeControl(input) {
  const initialMs = Number(input?.initialSeconds) * 1000;
  const incrementMs = Number(input?.incrementSeconds ?? 0) * 1000;
  const unlimited = input?.unlimited === true;
  if (unlimited) return { unlimited: true, initialMs: 0, incrementMs: 0 };
  if (!Number.isFinite(initialMs) || initialMs < MIN_INITIAL_MS || initialMs > MAX_INITIAL_MS) throw new Error("Invalid initial time");
  if (!Number.isFinite(incrementMs) || incrementMs < 0 || incrementMs > MAX_INCREMENT_MS) throw new Error("Invalid increment");
  return { unlimited: false, initialMs: Math.floor(initialMs), incrementMs: Math.floor(incrementMs) };
}

function safeResult(state, reason) {
  const { result, status } = state;
  return { result, status, reason: reason ?? state.reason };
}

function clockValues(state, now = Date.now()) {
  let white = state.whiteMs;
  let black = state.blackMs;
  if (!state.timeUnlimited && state.status === "active" && state.turnStartedAt) {
    const elapsed = Math.max(0, now - state.turnStartedAt);
    if (state.turn === "w") white = Math.max(0, white - elapsed);
    else black = Math.max(0, black - elapsed);
  }
  return { white: Math.floor(white), black: Math.floor(black) };
}

function pgnResult(result) {
  return result === "white" ? "1-0" : result === "black" ? "0-1" : result === "draw" ? "1/2-1/2" : "*";
}

function buildPgn(state) {
  const result = pgnResult(state.result);
  const chess = new Chess();
  for (const m of state.moves) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
  }
  const headers = [
    `[Event "Advanced Chess Friend Game"]`,
    `[Site "Advanced Chess"]`,
    `[Date "${new Date(state.createdAt).toISOString().slice(0, 10).replaceAll("-", ".")}"]`,
    `[Round "-"]`,
    `[White "${state.whiteName || "Anonymous"}"]`,
    `[Black "${state.blackName || "Anonymous"}"]`,
    `[Result "${result}"]`,
    `[TimeControl "${state.timeUnlimited ? "0" : `${Math.round(state.initialMs / 1000)}+${Math.round(state.incrementMs / 1000)}`}"]`
  ];
  const moveText = chess.history();
  let body = "";
  for (let i = 0; i < moveText.length; i++) {
    if (i % 2 === 0) body += `${Math.floor(i / 2) + 1}. ${moveText[i]} `;
    else body += `${moveText[i]} `;
  }
  body += result;
  return `${headers.join("\n")}\n\n${body.trim()}\n`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade");

    if (url.pathname === "/api/health") {
      return withSecurityHeaders(json({ ok: true, service: "advanced-chess", protocol: PROTOCOL }));
    }

    if (url.pathname === "/api/games" && request.method === "POST") {
      return withSecurityHeaders(await createGame(request, env));
    }

    if (url.pathname === "/api/games/join" && request.method === "POST") {
      return withSecurityHeaders(await joinGame(request, env));
    }

    if (url.pathname === "/api/openings/catalog" && request.method === "GET") {
      return withSecurityHeaders(await openingCatalogRoute(request, env));
    }

    if (url.pathname === "/api/openings/search" && request.method === "GET") {
      return withSecurityHeaders(await openingSearchRoute(request, env));
    }

    if (url.pathname === "/api/openings/identify" && request.method === "GET") {
      return withSecurityHeaders(await openingIdentifyRoute(request, env));
    }

    if (url.pathname === "/api/openings/explorer" && request.method === "GET") {
      return withSecurityHeaders(await openingExplorerRoute(request, env));
    }

    if (url.pathname === "/api/openings/game-pgn" && request.method === "GET") {
      return withSecurityHeaders(await openingGamePgnRoute(request, env));
    }

    if (url.pathname.startsWith("/ws/") && upgrade?.toLowerCase() === "websocket") {
      const gameId = url.pathname.slice(4).toUpperCase();
      if (!GAME_ID_RE.test(gameId)) return new Response("Bad game id", { status: 400 });
      const id = env.GAME_ROOMS.idFromName(gameId);
      return id ? env.GAME_ROOMS.get(id).fetch(request) : new Response("Game not found", { status: 404 });
    }

    const accountResponse = await handleAccountRequest(request, env, ctx);
    if (accountResponse) return withSecurityHeaders(accountResponse);

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  }
};

async function openingCatalogRoute(request, env) {
  try {
    await rateLimitOpeningRequest(request, env, "catalog", 30, 60);
    const catalog = await getOpeningCatalog(request, env);
    return publicJson({
      version: "lichess-chess-openings-master",
      count: catalog.length,
      openings: catalog.map(({ id, eco, name, pgn, uci, epd }) => ({ id, eco, name, pgn, uci, epd }))
    }, 200, OPENING_CATALOG_CACHE_TTL);
  } catch (error) {
    console.error("opening catalog error", error);
    const code = error?.message === "rate_limit_exceeded"
      ? "rate_limit_exceeded"
      : ["opening_catalog_asset_missing", "invalid_opening_catalog", "opening_catalog_too_large"].includes(error?.message)
        ? error.message
        : "opening_catalog_unavailable";
    return publicJson({ error: code }, code === "rate_limit_exceeded" ? 429 : 503);
  }
}

async function openingSearchRoute(request, env) {
  try {
    const query = normalizeSearchQuery(new URL(request.url).searchParams.get("q") || "");
    await rateLimitOpeningRequest(request, env, "search", 120, 60);
    const catalog = await getOpeningCatalog(request, env);
    const limitRaw = new URL(request.url).searchParams.get("limit");
    const limit = /^\d+$/.test(String(limitRaw || "")) ? Math.max(1, Math.min(50, Number(limitRaw))) : 30;
    const results = openingSearchResults(catalog, query, limit);
    return publicJson({ count: results.length, results }, 200, 60);
  } catch (error) {
    const code = error?.message === "rate_limit_exceeded" ? "rate_limit_exceeded" : error?.message || "opening_search_failed";
    return publicJson({ error: code }, code === "rate_limit_exceeded" ? 429 : 400);
  }
}

async function openingIdentifyRoute(request, env) {
  try {
    await rateLimitOpeningRequest(request, env, "identify", 120, 60);
    const url = new URL(request.url);
    const catalog = await getOpeningCatalog(request, env);
    const result = identifyOpening(catalog, url.searchParams.get("play") || "", url.searchParams.get("fen") || "");
    return publicJson(result, 200, 60);
  } catch (error) {
    const code = error?.message === "rate_limit_exceeded" ? "rate_limit_exceeded" : error?.message || "opening_identify_failed";
    const status = code === "rate_limit_exceeded" ? 429 : 400;
    return publicJson({ error: code }, status);
  }
}

async function openingExplorerRoute(request, env) {
  try {
    await rateLimitOpeningRequest(request, env, "explorer", 60, 60);
    const url = new URL(request.url);
    const params = validateExplorerParams(url);
    const cache = typeof caches !== "undefined" ? caches.default : null;
    if (cache) {
      const cached = await cache.match(request);
      if (cached) return withPublicCacheHeaders(cached, OPENING_EXPLORER_CACHE_TTL);
    }

    const key = url.toString();
    const existing = openingExplorerInFlight.get(key);
    if (existing) return publicJson(await existing, 200, OPENING_EXPLORER_CACHE_TTL);

    const work = fetchExplorerData(params).finally(() => openingExplorerInFlight.delete(key));
    openingExplorerInFlight.set(key, work);
    const data = await work;
    const response = publicJson(data, 200, OPENING_EXPLORER_CACHE_TTL);
    if (cache) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const code = error?.message === "rate_limit_exceeded" ? "rate_limit_exceeded" : error?.message || "opening_explorer_failed";
    const status = code === "rate_limit_exceeded" ? 429 : error?.status || 502;
    return publicJson({ error: code }, status);
  }
}

async function openingGamePgnRoute(request, env) {
  try {
    await rateLimitOpeningRequest(request, env, "game-pgn", 30, 60);
    const url = new URL(request.url);
    const id = String(url.searchParams.get("id") || "").trim();
    const source = String(url.searchParams.get("source") || "masters");
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(id)) return publicJson({ error: "invalid_game_id" }, 400);
    if (!['masters', 'lichess'].includes(source)) return publicJson({ error: "invalid_game_source" }, 400);
    const cache = typeof caches !== "undefined" ? caches.default : null;
    if (cache) {
      const cached = await cache.match(request);
      if (cached) return withPublicCacheHeaders(cached, OPENING_EXPLORER_CACHE_TTL);
    }
    const upstreamUrl = source === "masters"
      ? `https://explorer.lichess.org/masters/pgn/${encodeURIComponent(id)}`
      : `https://lichess.org/game/export/${encodeURIComponent(id)}`;
    const upstream = await fetchWithTimeout(upstreamUrl, {
      headers: { accept: "application/x-chess-pgn,text/plain;q=0.9,*/*;q=0.1", "user-agent": "Advanced-Chess-Opening-Atlas/1.0" }
    }, 8000);
    if (!upstream.ok) return publicJson({ error: "model_game_unavailable" }, upstream.status === 404 ? 404 : 502);
    const body = await upstream.text();
    if (body.length > 256 * 1024) return publicJson({ error: "model_game_too_large" }, 502);
    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/x-chess-pgn; charset=utf-8",
        "cache-control": `public, max-age=${OPENING_EXPLORER_CACHE_TTL}, stale-while-revalidate=3600`
      }
    });
    if (cache) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const code = error?.message === "rate_limit_exceeded" ? "rate_limit_exceeded" : "model_game_unavailable";
    return publicJson({ error: code }, code === "rate_limit_exceeded" ? 429 : 502);
  }
}

async function getOpeningCatalog(request, env) {
  if (openingCatalogMemory.value) return openingCatalogMemory.value;
  if (openingCatalogMemory.promise) return openingCatalogMemory.promise;
  openingCatalogMemory.promise = (async () => {
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const assetCatalog = await readStaticOpeningCatalog(request, env);
    if (!assetCatalog?.length) throw new Error("opening_catalog_asset_missing");
    if (assetCatalog.length < 3000) throw new Error("invalid_opening_catalog");
    openingCatalogMemory.value = assetCatalog;
    if (cache) {
      const cacheUrl = new URL(request.url);
      cacheUrl.pathname = "/__internal/opening-catalog-v1";
      cacheUrl.search = "";
      const cacheRequest = new Request(cacheUrl.toString(), { method: "GET" });
      await cache.put(cacheRequest, new Response(JSON.stringify({
        version: "static-asset",
        count: assetCatalog.length,
        openings: assetCatalog,
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${OPENING_CATALOG_CACHE_TTL}`,
        },
      }));
    }
    return openingCatalogMemory.value;
  })().finally(() => { openingCatalogMemory.promise = null; });
  return openingCatalogMemory.promise;
}

async function readStaticOpeningCatalog(request, env) {
  if (!env?.ASSETS?.fetch) throw new Error("opening_catalog_asset_missing");
  try {
    const url = new URL("/openings/catalog.json", request.url);
    const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
    if (!response.ok) throw new Error("opening_catalog_asset_missing");
    const body = await response.json();
    if (!Array.isArray(body?.openings) || !body.openings.length) throw new Error("invalid_opening_catalog");
    if (body.openings.length > 20_000) throw new Error("opening_catalog_too_large");
    const valid = body.openings.every((entry) =>
      entry &&
      typeof entry.id === "string" && entry.id.length <= 500 &&
      typeof entry.eco === "string" && /^([A-E]\d{2})$/.test(entry.eco) &&
      typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 500 &&
      typeof entry.pgn === "string" && entry.pgn.length <= 1000 &&
      typeof entry.uci === "string" && entry.uci.length <= 1500 &&
      typeof entry.epd === "string" && entry.epd.length <= 100
    );
    if (!valid) throw new Error("invalid_opening_catalog");
    return body.openings;
  } catch (error) {
    if (error?.message === "opening_catalog_asset_missing") throw error;
    if (["opening_catalog_too_large", "invalid_opening_catalog"].includes(error?.message)) throw error;
    throw new Error("invalid_opening_catalog");
  }
}

async function fetchExplorerData(params) {
  if (params.source === "combined") {
    let masters = null;
    let lichess = null;
    let mastersError = null;
    let lichessError = null;
    try { masters = await fetchExplorerSource({ ...params, source: "masters" }); } catch (error) { mastersError = error?.message || "masters_unavailable"; }
    try { lichess = await fetchExplorerSource({ ...params, source: "lichess" }); } catch (error) { lichessError = error?.message || "lichess_unavailable"; }
    if (!masters && !lichess) {
      const error = new Error("opening_sources_unavailable");
      error.status = 502;
      throw error;
    }
    const merged = mergeExplorerResponses(masters, lichess, params.moves);
    return {
      source: "combined",
      partial: Boolean(mastersError || lichessError),
      failedSources: [mastersError ? "masters" : null, lichessError ? "lichess" : null].filter(Boolean),
      ...merged,
    };
  }
  return { source: params.source, ...(await fetchExplorerSource(params)) };
}

async function fetchExplorerSource(params) {
  const upstreamUrl = buildExplorerRequest(params);
  const response = await fetchWithTimeout(upstreamUrl, {
    headers: { accept: "application/json", "user-agent": "Advanced-Chess-Opening-Atlas/1.0" }
  }, 8000);
  if (!response.ok) throw new Error(`explorer_upstream_${response.status}`);
  const raw = await response.json();
  return normalizeExplorerResponse(raw, params.source);
}


async function fetchWithTimeout(input, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("upstream_timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal || controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function publicJson(data, status = 200, maxAge = 0) {
  const response = json(data, status);
  if (maxAge > 0) response.headers.set("cache-control", `public, max-age=${maxAge}, stale-while-revalidate=${Math.max(maxAge, 60)}`);
  return response;
}

function withPublicCacheHeaders(response, maxAge) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${maxAge}, stale-while-revalidate=${Math.max(maxAge, 60)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function rateLimitOpeningRequest(request, env, bucket, limit, periodSeconds) {
  await rateLimitGameRequest(request, env, `opening:${bucket}`, limit, periodSeconds);
}

async function createGame(request, env) {
  try {
    const origin = request.headers.get("Origin");
    const host = request.headers.get("Host");
    if (origin && new URL(origin).host !== host) return json({ error: "origin_not_allowed" }, 403);
    await rateLimitGameRequest(request, env, "create", 12, 60);
    const body = await request.json();
    const identity = await resolvePlayerIdentity(request, env);
    const name = sanitizeName(identity?.username || "Anonymous");
    const timeControl = normalizeTimeControl(body?.timeControl);
    const colorPreference = ["random", "w", "b"].includes(body?.colorPreference) ? body.colorPreference : "random";

    for (let tries = 0; tries < 8; tries++) {
      const gameId = randomGameId();
      const playerToken = randomToken();
      const room = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(gameId));
      const response = await room.fetch(new Request("https://room.internal/init", {
        method: "POST",
        body: JSON.stringify({
          gameId,
          name,
          playerToken,
          timeControl,
          colorPreference,
          userId: identity?.userId || null,
          guestId: identity?.guestId || null
        })
      }));
      if (response.ok) {
        return json({ gameId, playerToken, sharePath: `/chess.html?friend=${gameId}` });
      }
    }
    return json({ error: "game_creation_failed" }, 503);
  } catch (error) {
    const code = error?.message === "rate_limit_exceeded" ? "rate_limit_exceeded" : error?.message === "origin_not_allowed" ? "origin_not_allowed" : "invalid_request";
    const status = code === "rate_limit_exceeded" ? 429 : code === "origin_not_allowed" ? 403 : 400;
    return json({ error: code }, status);
  }
}

async function joinGame(request, env) {
  try {
    const origin = request.headers.get("Origin");
    const host = request.headers.get("Host");
    if (origin && new URL(origin).host !== host) return json({ error: "origin_not_allowed" }, 403);
    await rateLimitGameRequest(request, env, "join", 60, 60);
    const body = await request.json();
    const gameId = String(body?.gameId || "").toUpperCase();
    if (!GAME_ID_RE.test(gameId)) return json({ error: "invalid_game_id" }, 400);
    const identity = await resolvePlayerIdentity(request, env);
    const name = sanitizeName(identity?.username || "Anonymous");
    const playerToken = randomToken();
    const tokenHash = await sha256Hex(playerToken);
    const room = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(gameId));
    const response = await room.fetch(new Request("https://room.internal/join-token", {
      method: "POST",
      body: JSON.stringify({
        gameId,
        name,
        playerToken,
        tokenHash,
        userId: identity?.userId || null,
        guestId: identity?.guestId || null
      })
    }));
    const data = await response.json().catch(() => ({}));
    return json(data, response.status);
  } catch (error) {
    const code = error?.message === "rate_limit_exceeded" ? "rate_limit_exceeded" : error?.message === "origin_not_allowed" ? "origin_not_allowed" : "invalid_request";
    const status = code === "rate_limit_exceeded" ? 429 : code === "origin_not_allowed" ? 403 : 400;
    return json({ error: code }, status);
  }
}


async function rateLimitGameRequest(request, env, bucket, limit, periodSeconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  const key = `game-api:${bucket}:${ip}`;
  if (env.ACCOUNT_RATE_LIMITER?.limit) {
    const result = await env.ACCOUNT_RATE_LIMITER.limit({ key });
    if (!result.success) throw new Error("rate_limit_exceeded");
    return;
  }
  // Small fallback limiter local to this request path. Account endpoints use the
  // stronger D1-backed limiter; game creation/joining is primarily protected by
  // high-entropy game IDs and this edge-facing throttle.
  if (!env.ACCOUNTS) return;
  const hash = await sha256Hex(key);
  const now = Date.now();
  const windowStart = Math.floor(now / (periodSeconds * 1000)) * (periodSeconds * 1000);
  const row = await env.ACCOUNTS.prepare("SELECT count FROM rate_limits WHERE key_hash=? AND window_start=?").bind(hash, windowStart).first();
  if (Number(row?.count || 0) >= limit) throw new Error("rate_limit_exceeded");
  await env.ACCOUNTS.prepare("INSERT INTO rate_limits(key_hash,window_start,count) VALUES(?,?,1) ON CONFLICT(key_hash,window_start) DO UPDATE SET count=count+1").bind(hash, windowStart).run();
  const after = await env.ACCOUNTS.prepare("SELECT count FROM rate_limits WHERE key_hash=? AND window_start=?").bind(hash, windowStart).first();
  if (Number(after?.count || 0) > limit) throw new Error("rate_limit_exceeded");
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.chesscomfiles.com; media-src 'self' https://images.chesscomfiles.com; font-src 'self' data:; connect-src 'self' https://lichess.org; worker-src 'self' blob:");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function categoryForTimeControlMs(initialMs) {
  const seconds = Number(initialMs || 0) / 1000;
  if (seconds < 180) return "bullet";
  if (seconds < 600) return "blitz";
  if (seconds <= 1800) return "rapid";
  return "classical";
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.initSchema();
  }

  initSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS game (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        game_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        expires_at INTEGER NOT NULL,
        initial_ms INTEGER NOT NULL,
        increment_ms INTEGER NOT NULL,
        time_unlimited INTEGER NOT NULL,
        white_ms INTEGER NOT NULL,
        black_ms INTEGER NOT NULL,
        turn TEXT NOT NULL,
        turn_started_at INTEGER,
        fen TEXT NOT NULL,
        seq INTEGER NOT NULL,
        white_token_hash TEXT,
        black_token_hash TEXT,
        white_user_id TEXT,
        black_user_id TEXT,
        white_guest_id TEXT,
        black_guest_id TEXT,
        white_name TEXT,
        black_name TEXT,
        preferred_color TEXT,
        draw_offer TEXT,
        moves_json TEXT NOT NULL,
        pgn TEXT,
        account_recorded INTEGER NOT NULL DEFAULT 0,
        account_record_attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_game_status ON game(status);
      CREATE TABLE IF NOT EXISTS commands (
        command_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    for (const column of [
      ["white_user_id", "TEXT"], ["black_user_id", "TEXT"],
      ["white_guest_id", "TEXT"], ["black_guest_id", "TEXT"],
      ["account_recorded", "INTEGER NOT NULL DEFAULT 0"], ["account_record_attempts", "INTEGER NOT NULL DEFAULT 0"]
    ]) {
      try { this.ctx.storage.sql.exec(`ALTER TABLE game ADD COLUMN ${column[0]} ${column[1]}`); } catch {}
    }
  }

  row() {
    return this.ctx.storage.sql.exec("SELECT * FROM game WHERE id = 1").toArray()[0] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") return this.initialize(await request.json());
    if (url.pathname === "/join-token" && request.method === "POST") return this.joinToken(await request.json());
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") return this.handleWebSocket(request);
    if (url.pathname === "/pgn" && request.method === "GET") return this.pgnResponse();
    return new Response("Not found", { status: 404 });
  }

  async initialize(payload) {
    if (this.row()) return new Response("Exists", { status: 409 });
    const now = Date.now();
    const time = payload.timeControl;
    let whiteTokenHash = null;
    let blackTokenHash = null;
    let whiteName = null;
    let blackName = null;
    let assignedColor = payload.colorPreference;
    if (assignedColor === "random") assignedColor = (randomBytes(1)[0] & 1) ? "w" : "b";
    if (assignedColor === "w") {
      whiteTokenHash = await sha256Hex(payload.playerToken);
      whiteName = sanitizeName(payload.name);
    } else {
      blackTokenHash = await sha256Hex(payload.playerToken);
      blackName = sanitizeName(payload.name);
    }
    const initialMs = time.unlimited ? 0 : Number(time.initialMs);
    const incrementMs = time.unlimited ? 0 : Number(time.incrementMs);
    const whiteMs = initialMs;
    const blackMs = initialMs;
    this.ctx.storage.sql.exec(
      `INSERT INTO game
      (id,game_id,status,result,reason,created_at,started_at,ended_at,expires_at,initial_ms,increment_ms,time_unlimited,white_ms,black_ms,turn,turn_started_at,fen,seq,white_token_hash,black_token_hash,white_user_id,black_user_id,white_guest_id,black_guest_id,white_name,black_name,preferred_color,draw_offer,moves_json,pgn)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      payload.gameId, "waiting", null, null, now, null, null, now + GAME_TTL_MS,
      initialMs, incrementMs, time.unlimited ? 1 : 0, whiteMs, blackMs, "w", null, new Chess().fen(), 0,
      whiteTokenHash, blackTokenHash, payload.userId || null, null, payload.guestId || null, null, whiteName, blackName, assignedColor, null, "[]", null
    );
    await this.ctx.storage.setAlarm(now + GAME_TTL_MS);
    return json({ ok: true });
  }

  async joinToken(payload) {
    const row = this.row();
    if (!row) return json({ error: "game_not_found" }, 404);
    if (row.status !== "waiting") return json({ error: "game_already_started" }, 409);
    if (Date.now() >= row.expires_at) {
      this.ctx.storage.sql.exec("DELETE FROM game WHERE id=1");
      return json({ error: "game_expired" }, 410);
    }
    const openColor = row.white_token_hash ? "b" : "w";
    const token = String(payload?.playerToken || "");
    const hash = String(payload?.tokenHash || "");
    if (!token || !hash) return json({ error: "join_token_error" }, 400);
    const name = sanitizeName(payload?.name);
    if (openColor === "w") this.ctx.storage.sql.exec("UPDATE game SET white_token_hash=?, white_name=?, white_user_id=?, white_guest_id=? WHERE id=1", hash, name, payload.userId || null, payload.guestId || null);
    else this.ctx.storage.sql.exec("UPDATE game SET black_token_hash=?, black_name=?, black_user_id=?, black_guest_id=? WHERE id=1", hash, name, payload.userId || null, payload.guestId || null);
    return json({ gameId: row.game_id, playerToken: token, color: openColor });
  }

  state() {
    const row = this.row();
    if (!row) return null;
    return {
      gameId: row.game_id,
      status: row.status,
      result: row.result,
      reason: row.reason,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      expiresAt: row.expires_at,
      initialMs: row.initial_ms,
      incrementMs: row.increment_ms,
      timeUnlimited: !!row.time_unlimited,
      whiteMs: row.white_ms,
      blackMs: row.black_ms,
      turn: row.turn,
      turnStartedAt: row.turn_started_at,
      fen: row.fen,
      seq: row.seq,
      whiteName: row.white_name,
      blackName: row.black_name,
      whiteUserId: row.white_user_id || null,
      blackUserId: row.black_user_id || null,
      whiteGuestId: row.white_guest_id || null,
      blackGuestId: row.black_guest_id || null,
      drawOffer: row.draw_offer,
      moves: JSON.parse(row.moves_json || "[]"),
      pgn: row.pgn,
      accountRecorded: !!row.account_recorded,
      accountRecordAttempts: Number(row.account_record_attempts || 0)
    };
  }

  snapshot(state = this.state(), now = Date.now()) {
    if (!state) return null;
    const clocks = clockValues(state, now);
    return {
      protocol: PROTOCOL,
      gameId: state.gameId,
      status: state.status,
      result: state.result,
      reason: state.reason,
      seq: state.seq,
      turn: state.turn,
      fen: state.fen,
      moves: state.moves,
      clocks,
      initialMs: state.initialMs,
      incrementMs: state.incrementMs,
      timeUnlimited: state.timeUnlimited,
      white: { name: state.whiteName || "Waiting…", present: !!state.whiteName },
      black: { name: state.blackName || "Waiting…", present: !!state.blackName },
      drawOffer: state.drawOffer,
      claimable: { threefold: this.isThreefoldClaimable(state), fifty: this.isFiftyClaimable(state) },
      serverNow: now,
      pgn: state.pgn
    };
  }

  chessFromState(state) {
    const chess = new Chess();
    for (const m of state.moves || []) chess.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
    return chess;
  }

  positionFen(moves) {
    const chess = new Chess();
    for (const m of moves || []) chess.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
    return chess.fen();
  }

  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const url = new URL(request.url);
    const idHeader = request.headers.get("Origin");
    const allowedOrigin = request.headers.get("Host");
    if (idHeader && new URL(idHeader).host !== allowedOrigin) return new Response("Origin rejected", { status: 403 });

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authenticated: false });
    this.send(server, { type: "hello_required", protocol: PROTOCOL });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (raw.length > MAX_MESSAGE) return this.failAndClose(ws, "message_too_large");
    let data;
    try { data = JSON.parse(raw); } catch { return this.send(ws, { type: "error", code: "invalid_json" }); }
    if (!data || data.protocol !== PROTOCOL || typeof data.type !== "string") return this.send(ws, { type: "error", code: "invalid_protocol" });
    try {
      const attachment = ws.deserializeAttachment() || { authenticated: false };
      if (!attachment.authenticated) return this.handleHello(ws, data);
      return this.handleCommand(ws, attachment, data);
    } catch (error) {
      this.send(ws, { type: "error", code: "server_error", message: error?.message || "Server error" });
    }
  }

  async handleHello(ws, data) {
    if (data.type !== "hello" || typeof data.token !== "string" || !data.token) return this.send(ws, { type: "error", code: "hello_required" });
    const state = this.state();
    if (!state) return this.failAndClose(ws, "game_not_found");
    if (Date.now() >= state.expiresAt && state.status === "waiting") {
      this.ctx.storage.sql.exec("DELETE FROM game WHERE id=1");
      return this.failAndClose(ws, "game_expired");
    }
    const hash = await sha256Hex(data.token);
    let color = null;
    if (this.row().white_token_hash === hash) color = "w";
    if (this.row().black_token_hash === hash) color = "b";

    if (!color) {
      return this.failAndClose(ws, "invalid_player_token");
    }

    const name = color === "w" ? state.whiteName || sanitizeName(data.name) : state.blackName || sanitizeName(data.name);
    if (color === "w" && !this.row().white_name) this.ctx.storage.sql.exec("UPDATE game SET white_name=? WHERE id=1", name);
    if (color === "b" && !this.row().black_name) this.ctx.storage.sql.exec("UPDATE game SET black_name=? WHERE id=1", name);

    const newState = this.state();
    if (newState.status === "waiting" && newState.whiteName && newState.blackName) {
      const now = Date.now();
      this.ctx.storage.sql.exec("UPDATE game SET status='active', started_at=?, turn_started_at=?, expires_at=? WHERE id=1", now, newState.timeUnlimited ? null : now, now + ACTIVE_GAME_TTL_MS);
      await this.ctx.storage.setAlarm(newState.timeUnlimited ? now + ACTIVE_GAME_TTL_MS : now + newState.whiteMs + 1000);
    }

    ws.serializeAttachment({ authenticated: true, color, tokenHash: hash });
    this.send(ws, { type: "welcome", color, state: this.snapshot() });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  commandIsCurrent(state, data) {
    return !Number.isInteger(data?.baseSeq) || data.baseSeq === state.seq;
  }

  async handleCommand(ws, attachment, data) {
    const state = this.state();
    if (!state) return this.failAndClose(ws, "game_not_found");
    const commandId = typeof data.commandId === "string" ? data.commandId : "";
    if (data.type === "move") return this.move(ws, attachment, data, commandId);
    if (data.type === "offer_draw") return this.simpleDraw(ws, attachment, data, commandId);
    if (data.type === "claim_draw") return this.claimDraw(ws, attachment, data, commandId);
    if (data.type === "decline_draw") return this.declineDraw(ws, attachment, data, commandId);
    if (data.type === "accept_draw") return this.acceptDraw(ws, attachment, data, commandId);
    if (data.type === "resign") return this.resign(ws, attachment, data, commandId);
    if (data.type === "sync_request") return this.send(ws, { type: "state", state: this.snapshot() });
    if (data.type === "ping") return this.send(ws, { type: "pong", serverNow: Date.now() });
    return this.send(ws, { type: "error", code: "unknown_command" });
  }

  rememberCommand(commandId, result) {
    if (!commandId) return;
    try { this.ctx.storage.sql.exec("INSERT OR IGNORE INTO commands VALUES (?,?,?)", commandId, JSON.stringify(result), Date.now()); } catch {}
  }

  isDuplicateCommand(commandId) {
    if (!commandId) return false;
    try { return !!this.ctx.storage.sql.exec("SELECT 1 as one FROM commands WHERE command_id=?", commandId).toArray()[0]; } catch { return false; }
  }

  async recordFinishedGame(state, { result, reason, moves, whiteMs, blackMs, endedAt }) {
    const row = this.row();
    if (row?.account_recorded) return true;
    try {
      const pgn = buildPgn({ ...state, status: "finished", result, reason, moves, whiteMs, blackMs, endedAt });
      await recordCompletedGame(this.env, {
        gameId: state.gameId,
        whiteUserId: state.whiteUserId,
        blackUserId: state.blackUserId,
        whiteGuestId: state.whiteGuestId,
        blackGuestId: state.blackGuestId,
        category: categoryForTimeControlMs(state.initialMs),
        timeControl: `${Math.round(state.initialMs / 1000)}+${Math.round(state.incrementMs / 1000)}`,
        rated: false,
        result, reason, pgn,
        createdAt: state.createdAt,
        endedAt
      });
      this.ctx.storage.sql.exec("UPDATE game SET account_recorded=1 WHERE id=1");
      return true;
    } catch (error) {
      const attempts = Number(row?.account_record_attempts || 0) + 1;
      this.ctx.storage.sql.exec("UPDATE game SET account_record_attempts=? WHERE id=1", attempts);
      const retryAt = Math.min(Number(state.expiresAt || Date.now() + GAME_TTL_MS) - 1000, Date.now() + Math.min(60 * 60 * 1000, Math.max(15 * 1000, attempts * 15 * 1000)));
      if (retryAt > Date.now()) await this.ctx.storage.setAlarm(retryAt);
      console.error?.("game result recording failed; retained for retry", error);
      return false;
    }
  }

  async move(ws, a, data, commandId) {
    if (commandId && this.isDuplicateCommand(commandId)) return this.send(ws, { type: "duplicate", commandId });
    const state = this.state();
    if (state.status !== "active") return this.send(ws, { type: "error", code: "game_not_active", seq: state.seq });
    if (state.turn !== a.color) return this.send(ws, { type: "move_rejected", code: "not_your_turn", seq: state.seq });
    if (!Number.isInteger(data.baseSeq) || data.baseSeq !== state.seq) return this.send(ws, { type: "move_rejected", code: "state_out_of_date", seq: state.seq, state: this.snapshot() });
    const now = Date.now();
    let { white, black } = clockValues(state, now);
    if (!state.timeUnlimited && (state.turn === "w" ? white : black) <= 0) {
      return this.finishTimeout(state.turn, now);
    }
    if (typeof data.from !== "string" || typeof data.to !== "string" || !/^[a-h][1-8]$/.test(data.from) || !/^[a-h][1-8]$/.test(data.to)) return this.send(ws, { type: "move_rejected", code: "invalid_square", seq: state.seq });
    const promotion = ["q", "r", "b", "n"].includes(data.promotion) ? data.promotion : undefined;
    const chess = this.chessFromState(state);
    let played;
    try { played = chess.move({ from: data.from, to: data.to, promotion }); } catch { return this.send(ws, { type: "move_rejected", code: "illegal_move", seq: state.seq, state: this.snapshot(state) }); }
    const elapsed = state.timeUnlimited ? 0 : Math.max(0, now - state.turnStartedAt);
    if (!state.timeUnlimited) {
      if (state.turn === "w") white = Math.max(0, state.whiteMs - elapsed + state.incrementMs);
      else black = Math.max(0, state.blackMs - elapsed + state.incrementMs);
    }
    const moves = [...state.moves, {
      from: played.from,
      to: played.to,
      promotion: played.promotion || null,
      san: played.san,
      flags: played.flags || "",
      captured: played.captured || null,
      isEnPassant: typeof played.isEnPassant === "function" ? played.isEnPassant() : false,
      at: now
    }];
    const nextTurn = state.turn === "w" ? "b" : "w";
    const nextChess = chess;
    let status = "active";
    let result = null;
    let reason = null;
    if (nextChess.isCheckmate()) { status = "finished"; result = state.turn === "w" ? "white" : "black"; reason = "checkmate"; }
    else if (nextChess.isStalemate()) { status = "finished"; result = "draw"; reason = "stalemate"; }
    else if (nextChess.isInsufficientMaterial()) { status = "finished"; result = "draw"; reason = "insufficient_material"; }
    else if (this.isFivefoldRepetition(moves)) { status = "finished"; result = "draw"; reason = "fivefold_repetition"; }
    else {
      const halfmove = Number(String(nextChess.fen()).split(" ")[4] || 0);
      if (halfmove >= 150) { status = "finished"; result = "draw"; reason = "75_move"; }
    }
    const newSeq = state.seq + 1;
    const turnStartedAt = status === "active" && !state.timeUnlimited ? now : null;
    const expiresAt = status === "finished" ? now + 7 * 24 * 60 * 60 * 1000 : state.expiresAt;
    this.ctx.storage.sql.exec(`UPDATE game SET status=?, result=?, reason=?, ended_at=?, expires_at=?, white_ms=?, black_ms=?, turn=?, turn_started_at=?, fen=?, seq=?, moves_json=?, draw_offer=NULL, pgn=? WHERE id=1`,
      status, result, reason, status === "finished" ? now : null, expiresAt, white, black, nextTurn, turnStartedAt, nextChess.fen(), newSeq, JSON.stringify(moves), status === "finished" ? buildPgn({ ...state, moves, status, result, reason }) : null);
    if (status === "active" && !state.timeUnlimited) await this.ctx.storage.setAlarm(now + (nextTurn === "w" ? white : black) + 1000);
    if (status === "finished") {
      await this.ctx.storage.setAlarm(now + GAME_TTL_MS);
      await this.recordFinishedGame(state, { result, reason, moves, whiteMs: white, blackMs: black, endedAt: now });
    }
    this.rememberCommand(commandId, { ok: true, seq: newSeq });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  async finishTimeout(color, now) {
    const state = this.state();
    if (state.status !== "active") return;
    const clocks = clockValues(state, now);
    const flagging = color === "w" ? clocks.white <= 0 : clocks.black <= 0;
    if (!flagging) return;
    const chess = this.chessFromState(state);
    const draw = chess.isInsufficientMaterial();
    const result = draw ? "draw" : color === "w" ? "black" : "white";
    const reason = draw ? "timeout_insufficient_material" : "timeout";
    this.ctx.storage.sql.exec("UPDATE game SET status='finished', result=?, reason=?, ended_at=?, white_ms=?, black_ms=?, pgn=? WHERE id=1", result, reason, now, clocks.white, clocks.black, buildPgn({ ...state, status: "finished", result, reason, whiteMs: clocks.white, blackMs: clocks.black, endedAt: now }));
    await this.ctx.storage.setAlarm(now + GAME_TTL_MS);
    await this.recordFinishedGame(state, { result, reason, moves: state.moves, whiteMs: clocks.white, blackMs: clocks.black, endedAt: now });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  isFivefoldRepetition(moves) {
    try {
      const chess = new Chess();
      const counts = new Map([[chess.hash(), 1]]);
      for (const move of moves || []) {
        chess.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
        const hash = chess.hash();
        counts.set(hash, (counts.get(hash) ?? 0) + 1);
      }
      return (counts.get(chess.hash()) ?? 0) >= 5;
    } catch {
      return false;
    }
  }

  isThreefoldClaimable(state) {
    if (state.status !== "active") return false;
    try { return this.chessFromState(state).isThreefoldRepetition(); } catch { return false; }
  }

  isFiftyClaimable(state) {
    if (state.status !== "active") return false;
    try { return Number(String(state.fen).split(" ")[4] || 0) >= 100; } catch { return false; }
  }

  async claimDraw(ws, a, data, commandId) {
    const state = this.state();
    if (state.status !== "active") return;
    if (commandId && this.isDuplicateCommand(commandId)) return this.send(ws, { type: "duplicate", commandId });
    if (!this.commandIsCurrent(state, data)) return this.send(ws, { type: "error", code: "state_out_of_date", seq: state.seq, state: this.snapshot() });
    if (data.kind === "threefold" && !this.isThreefoldClaimable(state)) return this.send(ws, { type: "error", code: "threefold_not_claimable" });
    if (data.kind === "fifty" && !this.isFiftyClaimable(state)) return this.send(ws, { type: "error", code: "fifty_not_claimable" });
    if (!['threefold','fifty'].includes(data.kind)) return this.send(ws, { type: "error", code: "invalid_claim" });
    const now = Date.now();
    this.ctx.storage.sql.exec("UPDATE game SET status='finished', result='draw', reason=?, ended_at=?, pgn=?, seq=seq+1 WHERE id=1", data.kind === "threefold" ? "threefold_claim" : "fifty_move_claim", now, buildPgn({ ...state, status: "finished", result: "draw", reason: data.kind === "threefold" ? "threefold_claim" : "fifty_move_claim", endedAt: now }));
    this.rememberCommand(commandId, { ok: true });
    this.ctx.storage.setAlarm(now + GAME_TTL_MS);
    await this.recordFinishedGame(state, { result: "draw", reason: data.kind === "threefold" ? "threefold_claim" : "fifty_move_claim", moves: state.moves, whiteMs: state.whiteMs, blackMs: state.blackMs, endedAt: now });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  simpleDraw(ws, a, data, commandId) {
    const state = this.state();
    if (state.status !== "active") return;
    if (!this.commandIsCurrent(state, data)) return this.send(ws, { type: "error", code: "state_out_of_date", seq: state.seq, state: this.snapshot() });
    if (commandId && this.isDuplicateCommand(commandId)) return;
    if (state.drawOffer) return this.send(ws, { type: "error", code: "draw_already_offered" });
    this.ctx.storage.sql.exec("UPDATE game SET draw_offer=?, seq=seq+1 WHERE id=1", a.color);
    this.rememberCommand(commandId, { ok: true });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  declineDraw(ws, a, data, commandId) {
    const state = this.state();
    if (state.status !== "active") return;
    if (!this.commandIsCurrent(state, data)) return this.send(ws, { type: "error", code: "state_out_of_date", seq: state.seq, state: this.snapshot() });
    if (commandId && this.isDuplicateCommand(commandId)) return this.send(ws, { type: "duplicate", commandId });
    if (!state.drawOffer || state.drawOffer === a.color) return this.send(ws, { type: "error", code: "no_opponent_draw_offer" });
    this.ctx.storage.sql.exec("UPDATE game SET draw_offer=NULL, seq=seq+1 WHERE id=1");
    this.rememberCommand(commandId, { ok: true });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  async acceptDraw(ws, a, data, commandId) {
    const state = this.state();
    if (state.status !== "active") return;
    if (!this.commandIsCurrent(state, data)) return this.send(ws, { type: "error", code: "state_out_of_date", seq: state.seq, state: this.snapshot() });
    if (commandId && this.isDuplicateCommand(commandId)) return this.send(ws, { type: "duplicate", commandId });
    if (!state.drawOffer || state.drawOffer === a.color) return this.send(ws, { type: "error", code: "no_opponent_draw_offer" });
    const now = Date.now();
    this.ctx.storage.sql.exec("UPDATE game SET status='finished', result='draw', reason='agreement', ended_at=?, draw_offer=NULL, pgn=? , seq=seq+1 WHERE id=1", now, buildPgn({ ...state, status: "finished", result: "draw", reason: "agreement", endedAt: now }));
    this.rememberCommand(commandId, { ok: true });
    await this.ctx.storage.setAlarm(now + GAME_TTL_MS);
    await this.recordFinishedGame(state, { result: "draw", reason: "agreement", moves: state.moves, whiteMs: state.whiteMs, blackMs: state.blackMs, endedAt: now });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  async resign(ws, a, data, commandId) {
    const state = this.state();
    if (state.status !== "active") return;
    if (!this.commandIsCurrent(state, data)) return this.send(ws, { type: "error", code: "state_out_of_date", seq: state.seq, state: this.snapshot() });
    if (commandId && this.isDuplicateCommand(commandId)) return this.send(ws, { type: "duplicate", commandId });
    const now = Date.now();
    if (!state.timeUnlimited) {
      const clocks = clockValues(state, now);
      const remaining = a.color === "w" ? clocks.white : clocks.black;
      if (remaining <= 0) return this.finishTimeout(a.color, now);
    }
    const result = a.color === "w" ? "black" : "white";
    this.ctx.storage.sql.exec("UPDATE game SET status='finished', result=?, reason='resignation', ended_at=?, pgn=?, seq=seq+1 WHERE id=1", result, now, buildPgn({ ...state, status: "finished", result, reason: "resignation", endedAt: now }));
    this.rememberCommand(commandId, { ok: true });
    this.ctx.storage.setAlarm(now + GAME_TTL_MS);
    await this.recordFinishedGame(state, { result, reason: "resignation", moves: state.moves, whiteMs: state.whiteMs, blackMs: state.blackMs, endedAt: now });
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  async alarm() {
    const state = this.state();
    if (!state) return;
    const now = Date.now();
    if (state.status === "waiting") {
      if (now >= state.expiresAt) return this.ctx.storage.sql.exec("DELETE FROM game WHERE id=1");
      return this.ctx.storage.setAlarm(state.expiresAt);
    }
    if (state.status === "active" && !state.timeUnlimited) return this.finishTimeout(state.turn, now);
    if (state.status === "finished") {
      if (!state.accountRecorded) {
        await this.recordFinishedGame(state, { result: state.result, reason: state.reason, moves: state.moves, whiteMs: state.whiteMs, blackMs: state.blackMs, endedAt: state.endedAt || now });
        const latest = this.state();
        if (latest?.accountRecorded) return this.ctx.storage.setAlarm(latest.expiresAt);
      }
      if (now >= state.expiresAt) return this.ctx.storage.sql.exec("DELETE FROM game WHERE id=1");
      return this.ctx.storage.setAlarm(state.expiresAt);
    }
  }

  webSocketClose(ws) {
    // Presence is intentionally not used to pause clocks; disconnecting does not grant free time.
  }

  webSocketError(ws) {
    try { ws.close(); } catch {}
  }

  send(ws, payload) {
    try { ws.send(JSON.stringify(payload)); } catch {}
  }

  broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (typeof ws.readyState === "number" && ws.readyState !== 1) continue;
        ws.send(encoded);
      } catch {}
    }
  }

  failAndClose(ws, code) {
    this.send(ws, { type: "error", code });
    try { ws.close(4000, code); } catch {}
  }

  pgnResponse() {
    const state = this.state();
    if (!state?.pgn) return new Response("No PGN", { status: 404 });
    return new Response(state.pgn, { headers: { "content-type": "application/x-chess-pgn; charset=utf-8", "content-disposition": `attachment; filename="${state.gameId}.pgn"` } });
  }
}
