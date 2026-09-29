import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";

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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken() {
  return base64Url(randomBytes(TOKEN_BYTES));
}

function randomGameId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[b[i] % alphabet.length];
  }
  return out;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeName(name) {
  const value =
    typeof name === "string"
      ? name.trim().replace(/[\u0000-\u001F\u007F]/g, "")
      : "";

  return value.slice(0, NAME_MAX) || "Anonymous";
}

function normalizeTimeControl(input) {
  const initialMs = Number(input?.initialSeconds) * 1000;
  const incrementMs =
    Number(input?.incrementSeconds ?? 0) * 1000;
  const unlimited = input?.unlimited === true;

  if (unlimited) {
    return {
      unlimited: true,
      initialMs: 0,
      incrementMs: 0
    };
  }

  if (
    !Number.isFinite(initialMs) ||
    initialMs < MIN_INITIAL_MS ||
    initialMs > MAX_INITIAL_MS
  ) {
    throw new Error("Invalid initial time");
  }

  if (
    !Number.isFinite(incrementMs) ||
    incrementMs < 0 ||
    incrementMs > MAX_INCREMENT_MS
  ) {
    throw new Error("Invalid increment");
  }

  return {
    unlimited: false,
    initialMs: Math.floor(initialMs),
    incrementMs: Math.floor(incrementMs)
  };
}

function safeResult(state, reason) {
  const { result, status } = state;
  return {
    result,
    status,
    reason: reason ?? state.reason
  };
}

function clockValues(state, now = Date.now()) {
  let white = state.whiteMs;
  let black = state.blackMs;

  if (
    !state.timeUnlimited &&
    state.status === "active" &&
    state.turnStartedAt
  ) {
    const elapsed = Math.max(
      0,
      now - state.turnStartedAt
    );

    if (state.turn === "w") {
      white = Math.max(0, white - elapsed);
    } else {
      black = Math.max(0, black - elapsed);
    }
  }

  return {
    white: Math.floor(white),
    black: Math.floor(black)
  };
}

function pgnResult(result) {
  return result === "white"
    ? "1-0"
    : result === "black"
      ? "0-1"
      : result === "draw"
        ? "1/2-1/2"
        : "*";
}

function buildPgn(state) {
  const result = pgnResult(state.result);
  const chess = new Chess();

  for (const m of state.moves) {
    chess.move({
      from: m.from,
      to: m.to,
      promotion: m.promotion || undefined
    });
  }

  const headers = [
    `[Event "Advanced Chess Friend Game"]`,
    `[Site "Advanced Chess"]`,
    `[Date "${new Date(state.createdAt)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", ".")}"]`,
    `[Round "-"]`,
    `[White "${state.whiteName || "Anonymous"}"]`,
    `[Black "${state.blackName || "Anonymous"}"]`,
    `[Result "${result}"]`,
    `[TimeControl "${
      state.timeUnlimited
        ? "0"
        : `${Math.round(state.initialMs / 1000)}+${Math.round(
            state.incrementMs / 1000
          )}`
    }" ]`
  ];

  const moveText = chess.history();
  let body = "";

  for (let i = 0; i < moveText.length; i++) {
    if (i % 2 === 0) {
      body += `${Math.floor(i / 2) + 1}. ${moveText[i]} `;
    } else {
      body += `${moveText[i]} `;
    }
  }

  body += result;

  return `${headers.join("\n")}\n\n${body.trim()}\n`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade");

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "advanced-chess",
        protocol: PROTOCOL
      });
    }

    if (
      url.pathname === "/api/games" &&
      request.method === "POST"
    ) {
      return createGame(request, env);
    }

    if (
      url.pathname === "/api/games/join" &&
      request.method === "POST"
    ) {
      return joinGame(request, env);
    }

    if (
      url.pathname.startsWith("/ws/") &&
      upgrade?.toLowerCase() === "websocket"
    ) {
      const gameId = url.pathname
        .slice(4)
        .toUpperCase();

      if (!GAME_ID_RE.test(gameId)) {
        return new Response("Bad game id", {
          status: 400
        });
      }

      const id =
        env.GAME_ROOMS.idFromName(gameId);

      return id
        ? env.GAME_ROOMS.get(id).fetch(request)
        : new Response("Game not found", {
            status: 404
          });
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  }
};

async function createGame(request, env) {
  try {
    const origin = request.headers.get("Origin");
    const host = request.headers.get("Host");

    if (
      origin &&
      new URL(origin).host !== host
    ) {
      return json(
        { error: "origin_not_allowed" },
        403
      );
    }

    const body = await request.json();
    const name = sanitizeName(body?.name);

    const timeControl =
      normalizeTimeControl(body?.timeControl);

    const colorPreference = [
      "random",
      "w",
      "b"
    ].includes(body?.colorPreference)
      ? body.colorPreference
      : "random";

    for (let tries = 0; tries < 8; tries++) {
      const gameId = randomGameId();
      const playerToken = randomToken();

      const room =
        env.GAME_ROOMS.get(
          env.GAME_ROOMS.idFromName(gameId)
        );

      const response = await room.fetch(
        new Request(
          "https://room.internal/init",
          {
            method: "POST",
            body: JSON.stringify({
              gameId,
              name,
              playerToken,
              timeControl,
              colorPreference
            })
          }
        )
      );

      if (response.ok) {
        return json({
          gameId,
          playerToken,
          sharePath:
            `/chess.html?friend=${gameId}`
        });
      }
    }

    return json(
      { error: "game_creation_failed" },
      503
    );
  } catch (error) {
    return json(
      {
        error: "invalid_request",
        message:
          error?.message || "Invalid request"
      },
      400
    );
  }
}

async function joinGame(request, env) {
  try {
    const origin = request.headers.get("Origin");
    const host = request.headers.get("Host");

    if (
      origin &&
      new URL(origin).host !== host
    ) {
      return json(
        { error: "origin_not_allowed" },
        403
      );
    }

    const body = await request.json();

    const gameId = String(
      body?.gameId || ""
    ).toUpperCase();

    if (!GAME_ID_RE.test(gameId)) {
      return json(
        { error: "invalid_game_id" },
        400
      );
    }

    const name = sanitizeName(body?.name);
    const playerToken = randomToken();
    const tokenHash =
      await sha256Hex(playerToken);

    const room =
      env.GAME_ROOMS.get(
        env.GAME_ROOMS.idFromName(gameId)
      );

    const response = await room.fetch(
      new Request(
        "https://room.internal/join-token",
        {
          method: "POST",
          body: JSON.stringify({
            gameId,
            name,
            playerToken,
            tokenHash
          })
        }
      )
    );

    const data =
      await response.json().catch(
        () => ({})
      );

    return json(
      data,
      response.status
    );
  } catch (error) {
    return json(
      {
        error: "invalid_request",
        message:
          error?.message || "Invalid request"
      },
      400
    );
  }
}

function withSecurityHeaders(response) {
  const headers = new Headers(
    response.headers
  );

  headers.set(
    "X-Content-Type-Options",
    "nosniff"
  );

  headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );

  headers.set(
    "X-Frame-Options",
    "DENY"
  );

  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  return new Response(
    response.body,
    {
      status: response.status,
      statusText: response.statusText,
      headers
    }
  );
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
        white_name TEXT,
        black_name TEXT,
        preferred_color TEXT,
        draw_offer TEXT,
        moves_json TEXT NOT NULL,
        pgn TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_game_status
      ON game(status);
    `);
  }

  row() {
    return (
      this.ctx.storage.sql
        .exec(
          "SELECT * FROM game WHERE id = 1"
        )
        .toArray()[0] || null
    );
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      url.pathname === "/init" &&
      request.method === "POST"
    ) {
      return this.initialize(
        await request.json()
      );
    }

    if (
      url.pathname === "/join-token" &&
      request.method === "POST"
    ) {
      return this.joinToken(
        await request.json()
      );
    }

    if (
      request.headers
        .get("Upgrade")
        ?.toLowerCase() === "websocket"
    ) {
      return this.handleWebSocket(request);
    }

    if (
      url.pathname === "/pgn" &&
      request.method === "GET"
    ) {
      return this.pgnResponse();
    }

    return new Response("Not found", {
      status: 404
    });
  }

  async initialize(payload) {
    if (this.row()) {
      return new Response("Exists", {
        status: 409
      });
    }

    const now = Date.now();
    const time = payload.timeControl;

    let whiteTokenHash = null;
    let blackTokenHash = null;

    let whiteName = null;
    let blackName = null;

    let assignedColor =
      payload.colorPreference;

    if (assignedColor === "random") {
      assignedColor =
        (randomBytes(1)[0] & 1)
          ? "w"
          : "b";
    }

    if (assignedColor === "w") {
      whiteTokenHash =
        await sha256Hex(
          payload.playerToken
        );

      whiteName =
        sanitizeName(payload.name);
    } else {
      blackTokenHash =
        await sha256Hex(
          payload.playerToken
        );

      blackName =
        sanitizeName(payload.name);
    }

    const initialMs = time.unlimited
      ? 0
      : Number(time.initialMs);

    const incrementMs = time.unlimited
      ? 0
      : Number(time.incrementMs);

    const whiteMs = initialMs;
    const blackMs = initialMs;

    this.ctx.storage.sql.exec(
      `INSERT INTO game
      (id,game_id,status,result,reason,created_at,started_at,ended_at,expires_at,initial_ms,increment_ms,time_unlimited,white_ms,black_ms,turn,turn_started_at,fen,seq,white_token_hash,black_token_hash,white_name,black_name,preferred_color,draw_offer,moves_json,pgn)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      payload.gameId,
      "waiting",
      null,
      null,
      now,
      null,
      null,
      now + GAME_TTL_MS,
      initialMs,
      incrementMs,
      time.unlimited ? 1 : 0,
      whiteMs,
      blackMs,
      "w",
      null,
      new Chess().fen(),
      0,
      whiteTokenHash,
      blackTokenHash,
      whiteName,
      blackName,
      assignedColor,
      null,
      "[]",
      null
    );

    await this.ctx.storage.setAlarm(
      now + GAME_TTL_MS
    );

    return json({ ok: true });
  }

  async joinToken(payload) {
    const row = this.row();

    if (!row) {
      return json(
        { error: "game_not_found" },
        404
      );
    }

    if (row.status !== "waiting") {
      return json(
        {
          error: "game_already_started"
        },
        409
      );
    }

    const openColor =
      row.white_token_hash
        ? "b"
        : "w";

    const token = String(
      payload?.playerToken || ""
    );

    const hash = String(
      payload?.tokenHash || ""
    );

    if (!token || !hash) {
      return json(
        {
          error: "join_token_error"
        },
        400
      );
    }

    const name =
      sanitizeName(payload?.name);

    if (openColor === "w") {
      this.ctx.storage.sql.exec(
        "UPDATE game SET white_token_hash=?, white_name=? WHERE id=1",
        hash,
        name
      );
    } else {
      this.ctx.storage.sql.exec(
        "UPDATE game SET black_token_hash=?, black_name=? WHERE id=1",
        hash,
        name
      );
    }

    return json({
      gameId: row.game_id,
      playerToken: token,
      color: openColor
    });
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
      drawOffer: row.draw_offer,
      moves: JSON.parse(
        row.moves_json || "[]"
      ),
      pgn: row.pgn
    };
  }

  snapshot(
    state = this.state(),
    now = Date.now()
  ) {
    if (!state) return null;

    const clocks =
      clockValues(state, now);

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
      incrementMs: state.incrementMs,
      timeUnlimited:
        state.timeUnlimited,
      white: {
        name:
          state.whiteName ||
          "Waiting…",
        present:
          !!state.whiteName
      },
      black: {
        name:
          state.blackName ||
          "Waiting…",
        present:
          !!state.blackName
      },
      drawOffer:
        state.drawOffer,
      claimable: {
        threefold:
          this.isThreefoldClaimable(
            state
          ),
        fifty:
          this.isFiftyClaimable(
            state
          )
      },
      serverNow: now,
      pgn: state.pgn
    };
  }

  chessFromState(state) {
    const chess = new Chess();

    for (
      const m of state.moves || []
    ) {
      chess.move({
        from: m.from,
        to: m.to,
        promotion:
          m.promotion ||
          undefined
      });
    }

    return chess;
  }

  positionFen(moves) {
    const chess = new Chess();

    for (
      const m of moves || []
    ) {
      chess.move({
        from: m.from,
        to: m.to,
        promotion:
          m.promotion ||
          undefined
      });
    }

    return chess.fen();
  }

  async handleWebSocket(request) {
    const pair =
      new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    const url =
      new URL(request.url);

    const idHeader =
      request.headers.get(
        "Origin"
      );

    const allowedOrigin =
      request.headers.get(
        "Host"
      );

    if (
      idHeader &&
      new URL(idHeader).host !==
        allowedOrigin
    ) {
      return new Response(
        "Origin rejected",
        { status: 403 }
      );
    }

    /*
     * IMPORTANT:
     * Do not call setWebSocketAutoResponse()
     * here. The previous implementation used
     * the wrong API shape, which could prevent
     * the WebSocket connection from being
     * established correctly.
     */
    this.ctx.acceptWebSocket(
      server
    );

    server.serializeAttachment({
      authenticated: false
    });

    this.send(server, {
      type: "hello_required",
      protocol: PROTOCOL
    });

    return new Response(
      null,
      {
        status: 101,
        webSocket: client
      }
    );
  }

  webSocketMessage(ws, message) {
    const raw =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(
            message
          );

    if (
      raw.length >
      MAX_MESSAGE
    ) {
      return this.failAndClose(
        ws,
        "message_too_large"
      );
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return this.send(ws, {
        type: "error",
        code: "invalid_json"
      });
    }

    if (
      !data ||
      data.protocol !== PROTOCOL ||
      typeof data.type !==
        "string"
    ) {
      return this.send(ws, {
        type: "error",
        code: "invalid_protocol"
      });
    }

    try {
      const attachment =
        ws.deserializeAttachment() ||
        {
          authenticated: false
        };

      if (!attachment.authenticated) {
        return this.handleHello(
          ws,
          data
        );
      }

      return this.handleCommand(
        ws,
        attachment,
        data
      );
    } catch (error) {
      this.send(ws, {
        type: "error",
        code: "server_error",
        message:
          error?.message ||
          "Server error"
      });
    }
  }

  async handleHello(ws, data) {
    if (
      data.type !== "hello" ||
      typeof data.token !==
        "string" ||
      !data.token
    ) {
      return this.send(ws, {
        type: "error",
        code: "hello_required"
      });
    }

    const state = this.state();

    if (!state) {
      return this.failAndClose(
        ws,
        "game_not_found"
      );
    }

    const hash =
      await sha256Hex(
        data.token
      );

    let color = null;

    if (
      this.row()
        .white_token_hash ===
      hash
    ) {
      color = "w";
    }

    if (
      this.row()
        .black_token_hash ===
      hash
    ) {
      color = "b";
    }

    if (!color) {
      if (
        state.status !==
        "waiting"
      ) {
        return this.failAndClose(
          ws,
          "invalid_player_token"
        );
      }

      const name =
        sanitizeName(
          data.name
        );

      const row =
        this.row();

      if (
        row.white_token_hash ===
        null
      ) {
        this.ctx.storage.sql.exec(
          "UPDATE game SET white_token_hash=?, white_name=? WHERE id=1",
          hash,
          name
        );

        color = "w";
      } else if (
        row.black_token_hash ===
        null
      ) {
        this.ctx.storage.sql.exec(
          "UPDATE game SET black_token_hash=?, black_name=? WHERE id=1",
          hash,
          name
        );

        color = "b";
      } else {
        return this.failAndClose(
          ws,
          "game_full"
        );
      }
    }

    const name =
      color === "w"
        ? state.whiteName ||
          sanitizeName(
            data.name
          )
        : state.blackName ||
          sanitizeName(
            data.name
          );

    if (
      color === "w" &&
      !this.row().white_name
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE game SET white_name=? WHERE id=1",
        name
      );
    }

    if (
      color === "b" &&
      !this.row().black_name
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE game SET black_name=? WHERE id=1",
        name
      );
    }

    const sockets =
      this.ctx.getWebSockets();

    const existing =
      sockets.find(s => {
        const a =
          s.deserializeAttachment?.();

        return (
          a?.authenticated &&
          a.color === color
        );
      });

    if (
      existing &&
      existing !== ws
    ) {
      try {
        existing.close(
          4001,
          "replaced_by_new_connection"
        );
      } catch {}
    }

    const newState =
      this.state();

    if (
      newState.status ===
        "waiting" &&
      newState.whiteName &&
      newState.blackName
    ) {
      const now =
        Date.now();

      this.ctx.storage.sql.exec(
        "UPDATE game SET status='active', started_at=?, turn_started_at=?, expires_at=? WHERE id=1",
        now,
        newState.timeUnlimited
          ? null
          : now,
        now +
          ACTIVE_GAME_TTL_MS
      );

      await this.ctx.storage.setAlarm(
        newState.timeUnlimited
          ? now +
            ACTIVE_GAME_TTL_MS
          : now +
            newState.whiteMs +
            1000
      );
    }

    ws.serializeAttachment({
      authenticated: true,
      color,
      tokenHash: hash
    });

    this.send(ws, {
      type: "welcome",
      color,
      state: this.snapshot()
    });

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  async handleCommand(
    ws,
    attachment,
    data
  ) {
    const state =
      this.state();

    if (!state) {
      return this.failAndClose(
        ws,
        "game_not_found"
      );
    }

    const commandId =
      typeof data.commandId ===
      "string"
        ? data.commandId
        : "";

    if (
      data.type === "move"
    ) {
      return this.move(
        ws,
        attachment,
        data,
        commandId
      );
    }

    if (
      data.type ===
      "offer_draw"
    ) {
      return this.simpleDraw(
        ws,
        attachment,
        data,
        commandId
      );
    }

    if (
      data.type ===
      "claim_draw"
    ) {
      return this.claimDraw(
        ws,
        attachment,
        data,
        commandId
      );
    }

    if (
      data.type ===
      "decline_draw"
    ) {
      return this.declineDraw(
        ws,
        attachment,
        data,
        commandId
      );
    }

    if (
      data.type ===
      "accept_draw"
    ) {
      return this.acceptDraw(
        ws,
        attachment,
        data,
        commandId
      );
    }

    if (
      data.type === "resign"
    ) {
      return this.resign(
        ws,
        attachment,
        data,
        commandId
      );
    }

    if (
      data.type ===
      "sync_request"
    ) {
      return this.send(ws, {
        type: "state",
        state: this.snapshot()
      });
    }

    if (
      data.type === "ping"
    ) {
      return this.send(ws, {
        type: "pong",
        serverNow: Date.now()
      });
    }

    return this.send(ws, {
      type: "error",
      code: "unknown_command"
    });
  }

  rememberCommand(
    commandId,
    result
  ) {
    if (!commandId) return;

    try {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at INTEGER NOT NULL)"
      );
    } catch {}

    try {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO commands VALUES (?,?,?)",
        commandId,
        JSON.stringify(result),
        Date.now()
      );
    } catch {}
  }

  isDuplicateCommand(
    commandId
  ) {
    if (!commandId) return false;

    try {
      return !!this.ctx.storage.sql
        .exec(
          "SELECT 1 as one FROM commands WHERE command_id=?",
          commandId
        )
        .toArray()[0];
    } catch {
      return false;
    }
  }

  async move(
    ws,
    a,
    data,
    commandId
  ) {
    if (
      commandId &&
      this.isDuplicateCommand(
        commandId
      )
    ) {
      return this.send(ws, {
        type: "duplicate",
        commandId
      });
    }

    const state =
      this.state();

    if (
      state.status !==
      "active"
    ) {
      return this.send(ws, {
        type: "error",
        code: "game_not_active",
        seq: state.seq
      });
    }

    if (
      state.turn !==
      a.color
    ) {
      return this.send(ws, {
        type: "move_rejected",
        code: "not_your_turn",
        seq: state.seq
      });
    }

    if (
      !Number.isInteger(
        data.baseSeq
      ) ||
      data.baseSeq !==
        state.seq
    ) {
      return this.send(ws, {
        type: "move_rejected",
        code: "state_out_of_date",
        seq: state.seq,
        state: this.snapshot()
      });
    }

    const now =
      Date.now();

    let {
      white,
      black
    } =
      clockValues(
        state,
        now
      );

    if (
      !state.timeUnlimited &&
      (
        state.turn === "w"
          ? white
          : black
      ) <= 0
    ) {
      return this.finishTimeout(
        state.turn,
        now
      );
    }

    if (
      typeof data.from !==
        "string" ||
      typeof data.to !==
        "string" ||
      !/^[a-h][1-8]$/.test(
        data.from
      ) ||
      !/^[a-h][1-8]$/.test(
        data.to
      )
    ) {
      return this.send(ws, {
        type: "move_rejected",
        code: "invalid_square",
        seq: state.seq
      });
    }

    const promotion =
      [
        "q",
        "r",
        "b",
        "n"
      ].includes(
        data.promotion
      )
        ? data.promotion
        : undefined;

    const chess =
      this.chessFromState(
        state
      );

    let played;

    try {
      played = chess.move({
        from: data.from,
        to: data.to,
        promotion
      });
    } catch {
      return this.send(ws, {
        type: "move_rejected",
        code: "illegal_move",
        seq: state.seq,
        state:
          this.snapshot(state)
      });
    }

    const elapsed =
      state.timeUnlimited
        ? 0
        : Math.max(
            0,
            now -
              state.turnStartedAt
          );

    if (
      !state.timeUnlimited
    ) {
      if (
        state.turn === "w"
      ) {
        white = Math.max(
          0,
          state.whiteMs -
            elapsed +
            state.incrementMs
        );
      } else {
        black = Math.max(
          0,
          state.blackMs -
            elapsed +
            state.incrementMs
        );
      }
    }

    const moves = [
      ...state.moves,
      {
        from: played.from,
        to: played.to,
        promotion:
          played.promotion ||
          null,
        san: played.san,
        at: now
      }
    ];

    const nextTurn =
      state.turn === "w"
        ? "b"
        : "w";

    const nextChess =
      chess;

    let status = "active";
    let result = null;
    let reason = null;

    if (
      nextChess.isCheckmate()
    ) {
      status = "finished";
      result =
        state.turn === "w"
          ? "white"
          : "black";
      reason = "checkmate";
    } else if (
      nextChess.isStalemate()
    ) {
      status = "finished";
      result = "draw";
      reason = "stalemate";
    } else if (
      nextChess.isInsufficientMaterial()
    ) {
      status = "finished";
      result = "draw";
      reason =
        "insufficient_material";
    } else if (
      this.isFivefoldRepetition(
        moves
      )
    ) {
      status = "finished";
      result = "draw";
      reason =
        "fivefold_repetition";
    } else {
      const halfmove =
        Number(
          String(
            nextChess.fen()
          ).split(" ")[4] ||
            0
        );

      if (
        halfmove >= 150
      ) {
        status = "finished";
        result = "draw";
        reason = "75_move";
      }
    }

    const newSeq =
      state.seq + 1;

    const turnStartedAt =
      status === "active" &&
      !state.timeUnlimited
        ? now
        : null;

    const expiresAt =
      status === "finished"
        ? now +
          7 *
            24 *
            60 *
            60 *
            1000
        : state.expiresAt;

    this.ctx.storage.sql.exec(
      `UPDATE game SET status=?, result=?, reason=?, ended_at=?, expires_at=?, white_ms=?, black_ms=?, turn=?, turn_started_at=?, fen=?, seq=?, moves_json=?, draw_offer=NULL, pgn=? WHERE id=1`,
      status,
      result,
      reason,
      status === "finished"
        ? now
        : null,
      expiresAt,
      white,
      black,
      nextTurn,
      turnStartedAt,
      nextChess.fen(),
      newSeq,
      JSON.stringify(moves),
      status === "finished"
        ? buildPgn({
            ...state,
            moves,
            status,
            result,
            reason
          })
        : null
    );

    if (
      status === "active" &&
      !state.timeUnlimited
    ) {
      await this.ctx.storage.setAlarm(
        now +
          (
            nextTurn === "w"
              ? white
              : black
          ) +
          1000
      );
    }

    if (
      status === "finished"
    ) {
      await this.ctx.storage.setAlarm(
        now + GAME_TTL_MS
      );
    }

    this.rememberCommand(
      commandId,
      {
        ok: true,
        seq: newSeq
      }
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  async finishTimeout(
    color,
    now
  ) {
    const state =
      this.state();

    if (
      state.status !==
      "active"
    ) {
      return;
    }

    const clocks =
      clockValues(
        state,
        now
      );

    const flagging =
      color === "w"
        ? clocks.white <= 0
        : clocks.black <= 0;

    if (!flagging) return;

    const chess =
      this.chessFromState(
        state
      );

    const draw =
      chess.isInsufficientMaterial();

    const result =
      draw
        ? "draw"
        : color === "w"
          ? "black"
          : "white";

    const reason =
      draw
        ? "timeout_insufficient_material"
        : "timeout";

    this.ctx.storage.sql.exec(
      "UPDATE game SET status='finished', result=?, reason=?, ended_at=?, white_ms=?, black_ms=?, pgn=? WHERE id=1",
      result,
      reason,
      now,
      clocks.white,
      clocks.black,
      buildPgn({
        ...state,
        status: "finished",
        result,
        reason,
        whiteMs: clocks.white,
        blackMs: clocks.black,
        endedAt: now
      })
    );

    await this.ctx.storage.setAlarm(
      now + GAME_TTL_MS
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  isFivefoldRepetition(
    moves
  ) {
    try {
      const chess =
        new Chess();

      const counts =
        new Map([
          [chess.hash(), 1]
        ]);

      for (
        const move of moves || []
      ) {
        chess.move({
          from: move.from,
          to: move.to,
          promotion:
            move.promotion ||
            undefined
        });

        const hash =
          chess.hash();

        counts.set(
          hash,
          (
            counts.get(hash) ??
            0
          ) + 1
        );
      }

      return (
        (
          counts.get(
            chess.hash()
          ) ?? 0
        ) >= 5
      );
    } catch {
      return false;
    }
  }

  isThreefoldClaimable(
    state
  ) {
    if (
      state.status !==
      "active"
    ) {
      return false;
    }

    try {
      return this.chessFromState(
        state
      ).isThreefoldRepetition();
    } catch {
      return false;
    }
  }

  isFiftyClaimable(
    state
  ) {
    if (
      state.status !==
      "active"
    ) {
      return false;
    }

    try {
      return (
        Number(
          String(
            state.fen
          ).split(" ")[4] ||
            0
        ) >= 100
      );
    } catch {
      return false;
    }
  }

  claimDraw(
    ws,
    a,
    data,
    commandId
  ) {
    const state =
      this.state();

    if (
      state.status !==
      "active"
    ) {
      return;
    }

    if (
      data.kind ===
        "threefold" &&
      !this.isThreefoldClaimable(
        state
      )
    ) {
      return this.send(ws, {
        type: "error",
        code:
          "threefold_not_claimable"
      });
    }

    if (
      data.kind ===
        "fifty" &&
      !this.isFiftyClaimable(
        state
      )
    ) {
      return this.send(ws, {
        type: "error",
        code:
          "fifty_not_claimable"
      });
    }

    if (
      ![
        "threefold",
        "fifty"
      ].includes(
        data.kind
      )
    ) {
      return this.send(ws, {
        type: "error",
        code:
          "invalid_claim"
      });
    }

    const now =
      Date.now();

    this.ctx.storage.sql.exec(
      "UPDATE game SET status='finished', result='draw', reason=?, ended_at=?, pgn=?, seq=seq+1 WHERE id=1",
      data.kind ===
        "threefold"
        ? "threefold_claim"
        : "fifty_move_claim",
      now,
      buildPgn({
        ...state,
        status: "finished",
        result: "draw",
        reason:
          data.kind ===
          "threefold"
            ? "threefold_claim"
            : "fifty_move_claim",
        endedAt: now
      })
    );

    this.rememberCommand(
      commandId,
      {
        ok: true
      }
    );

    this.ctx.storage.setAlarm(
      now + GAME_TTL_MS
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  simpleDraw(
    ws,
    a,
    data,
    commandId
  ) {
    const state =
      this.state();

    if (
      state.status !==
      "active"
    ) {
      return;
    }

    if (
      commandId &&
      this.isDuplicateCommand(
        commandId
      )
    ) {
      return;
    }

    if (
      state.drawOffer
    ) {
      return this.send(ws, {
        type: "error",
        code:
          "draw_already_offered"
      });
    }

    this.ctx.storage.sql.exec(
      "UPDATE game SET draw_offer=?, seq=seq+1 WHERE id=1",
      a.color
    );

    this.rememberCommand(
      commandId,
      {
        ok: true
      }
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  declineDraw(
    ws,
    a,
    data,
    commandId
  ) {
    const state =
      this.state();

    if (
      !state.drawOffer ||
      state.drawOffer ===
        a.color
    ) {
      return this.send(ws, {
        type: "error",
        code:
          "no_opponent_draw_offer"
      });
    }

    this.ctx.storage.sql.exec(
      "UPDATE game SET draw_offer=NULL, seq=seq+1 WHERE id=1"
    );

    this.rememberCommand(
      commandId,
      {
        ok: true
      }
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  async acceptDraw(
    ws,
    a,
    data,
    commandId
  ) {
    const state =
      this.state();

    if (
      !state.drawOffer ||
      state.drawOffer ===
        a.color
    ) {
      return this.send(ws, {
        type: "error",
        code:
          "no_opponent_draw_offer"
      });
    }

    const now =
      Date.now();

    this.ctx.storage.sql.exec(
      "UPDATE game SET status='finished', result='draw', reason='agreement', ended_at=?, draw_offer=NULL, pgn=? , seq=seq+1 WHERE id=1",
      now,
      buildPgn({
        ...state,
        status: "finished",
        result: "draw",
        reason: "agreement",
        endedAt: now
      })
    );

    this.rememberCommand(
      commandId,
      {
        ok: true
      }
    );

    await this.ctx.storage.setAlarm(
      now + GAME_TTL_MS
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  resign(
    ws,
    a,
    data,
    commandId
  ) {
    const state =
      this.state();

    if (
      state.status !==
      "active"
    ) {
      return;
    }

    if (
      commandId &&
      this.isDuplicateCommand(
        commandId
      )
    ) {
      return;
    }

    const now =
      Date.now();

    const result =
      a.color === "w"
        ? "black"
        : "white";

    this.ctx.storage.sql.exec(
      "UPDATE game SET status='finished', result=?, reason='resignation', ended_at=?, pgn=?, seq=seq+1 WHERE id=1",
      result,
      now,
      buildPgn({
        ...state,
        status: "finished",
        result,
        reason:
          "resignation",
        endedAt: now
      })
    );

    this.rememberCommand(
      commandId,
      {
        ok: true
      }
    );

    this.ctx.storage.setAlarm(
      now + GAME_TTL_MS
    );

    this.broadcast({
      type: "state",
      state: this.snapshot()
    });
  }

  async alarm() {
    const state =
      this.state();

    if (!state) return;

    const now =
      Date.now();

    if (
      state.status ===
      "waiting"
    ) {
      if (
        now >=
        state.expiresAt
      ) {
        return this.ctx.storage.sql.exec(
          "DELETE FROM game WHERE id=1"
        );
      }

      return this.ctx.storage.setAlarm(
        state.expiresAt
      );
    }

    if (
      state.status ===
        "active" &&
      !state.timeUnlimited
    ) {
      return this.finishTimeout(
        state.turn,
        now
      );
    }

    if (
      state.status ===
      "finished"
    ) {
      if (
        now >=
        state.expiresAt
      ) {
        return this.ctx.storage.sql.exec(
          "DELETE FROM game WHERE id=1"
        );
      }

      return this.ctx.storage.setAlarm(
        state.expiresAt
      );
    }
  }

  webSocketClose(ws) {
    // Presence is intentionally not used to pause clocks;
    // disconnecting does not grant free time.
    try {
      ws.close();
    } catch {}
  }

  webSocketError(ws) {
    try {
      ws.close();
    } catch {}
  }

  send(ws, payload) {
    try {
      ws.send(
        JSON.stringify(payload)
      );
    } catch {}
  }

  broadcast(payload) {
    const encoded =
      JSON.stringify(payload);

    for (
      const ws of
        this.ctx.getWebSockets()
    ) {
      try {
        ws.send(encoded);
      } catch {}
    }
  }

  failAndClose(
    ws,
    code
  ) {
    this.send(ws, {
      type: "error",
      code
    });

    try {
      ws.close(
        4000,
        code
      );
    } catch {}
  }

  pgnResponse() {
    const state =
      this.state();

    if (!state?.pgn) {
      return new Response(
        "No PGN",
        {
          status: 404
        }
      );
    }

    return new Response(
      state.pgn,
      {
        headers: {
          "content-type":
            "application/x-chess-pgn; charset=utf-8",
          "content-disposition":
            `attachment; filename="${state.gameId}.pgn"`
        }
      }
    );
  }
}
