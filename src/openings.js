import { Chess, validateFen } from "chess.js";

export const OPENING_DATA_BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
export const OPENING_DATA_FILES = Object.freeze(["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"]);
export const EXPLORER_BASE = "https://explorer.lichess.org";
export const MAX_PLAY_PLIES = 160;
export const MAX_FEN_LENGTH = 100;
export const MAX_SEARCH_LENGTH = 120;
export const MAX_CATALOG_RESULTS = 80;
export const MAX_CATALOG_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_CATALOG_BYTES = 8 * 1024 * 1024;

function toEpd(fen) {
  return String(fen || "").trim().split(/\s+/).slice(0, 4).join(" ");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseRows(text) {
  const lines = String(text || "").split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (!line || index === 0) continue;
    const [eco, name, pgn] = line.split("\t");
    if (!eco || !name || !pgn) continue;
    rows.push({ eco: eco.trim(), name: name.trim(), pgn: pgn.trim() });
  }
  return rows;
}

function pgnToUciAndEpd(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const uci = history.map(move => `${move.from}${move.to}${move.promotion || ""}`).join(" ");
  return { uci, epd: toEpd(chess.fen()) };
}

export function parseOpeningTsv(text, sourceFile = "unknown.tsv") {
  const rows = parseRows(text);
  const entries = [];
  for (const row of rows) {
    try {
      const { uci, epd } = pgnToUciAndEpd(row.pgn);
      if (!uci || !epd) continue;
      entries.push({
        id: `${row.eco}|${row.name}|${uci}`,
        eco: row.eco,
        name: row.name,
        pgn: row.pgn,
        uci,
        epd,
        source: sourceFile,
      });
    } catch {
      // A malformed upstream line must not take down the complete catalogue.
    }
  }
  return entries;
}

export function buildOpeningCatalog(textByFile) {
  const dedupe = new Map();
  for (const file of OPENING_DATA_FILES) {
    const entries = parseOpeningTsv(textByFile?.[file] || "", file);
    for (const entry of entries) dedupe.set(entry.id, entry);
  }
  return [...dedupe.values()].sort((a, b) =>
    a.eco.localeCompare(b.eco) || a.name.localeCompare(b.name) || a.uci.localeCompare(b.uci)
  );
}

export function normalizeUciPlay(play = "") {
  const raw = String(play ?? "").trim();
  if (!raw) return [];
  if (raw.length > MAX_PLAY_PLIES * 7) throw new Error("play_too_long");
  const moves = raw.split(",").map(token => token.trim()).filter(Boolean);
  if (moves.length > MAX_PLAY_PLIES) throw new Error("play_too_long");
  for (const move of moves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error("invalid_uci");
  }
  return moves;
}

export function normalizeExplorerFen(fen) {
  const value = String(fen || "").trim();
  if (!value) return new Chess().fen();
  if (value.length > MAX_FEN_LENGTH) throw new Error("fen_too_long");
  const result = validateFen(value);
  if (!result.ok) throw new Error("invalid_fen");
  return value;
}

export function normalizeSearchQuery(query) {
  const value = String(query || "").trim();
  if (value.length > MAX_SEARCH_LENGTH) throw new Error("search_too_long");
  return value;
}

export function openingId(entry) {
  return encodeURIComponent(entry.id);
}

export function openingSearchResults(catalog, query, limit = 30) {
  const normalized = normalizeText(query);
  if (!normalized) return catalog.slice(0, Math.min(limit, MAX_CATALOG_RESULTS));
  const terms = normalized.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const entry of catalog) {
    const haystack = normalizeText(`${entry.name} ${entry.eco} ${entry.pgn}`);
    let score = 0;
    if (haystack === normalized) score += 1000;
    if (normalizeText(entry.name) === normalized) score += 900;
    if (normalizeText(entry.name).startsWith(normalized)) score += 500;
    if (haystack.includes(normalized)) score += 200;
    for (const term of terms) if (haystack.includes(term)) score += 25;
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, Math.min(limit, MAX_CATALOG_RESULTS)).map(item => item.entry);
}

export function identifyOpening(catalog, play = "", fen = "") {
  const moves = normalizeUciPlay(play);
  let chess = new Chess(normalizeExplorerFen(fen));
  const positions = [];
  positions.push({ ply: 0, epd: toEpd(chess.fen()) });
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    try {
      chess.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move[4] || undefined,
      });
    } catch {
      throw new Error("illegal_uci_sequence");
    }
    positions.push({ ply: index + 1, epd: toEpd(chess.fen()) });
  }
  const byEpd = new Map();
  for (const entry of catalog) {
    const bucket = byEpd.get(entry.epd) || [];
    bucket.push(entry);
    byEpd.set(entry.epd, bucket);
  }
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const matches = byEpd.get(positions[index].epd);
    if (!matches?.length) continue;
    const ranked = [...matches].sort((a, b) => b.uci.split(" ").length - a.uci.split(" ").length || a.name.localeCompare(b.name));
    return {
      opening: ranked[0],
      ply: positions[index].ply,
      transposition: !sequenceEqualsPrefix(ranked[0].uci, moves.slice(0, positions[index].ply)),
    };
  }
  return { opening: null, ply: null, transposition: false };
}

function sequenceEqualsPrefix(uciString, moves) {
  const line = String(uciString || "").split(/\s+/).filter(Boolean);
  if (line.length !== moves.length) return false;
  return line.every((move, index) => move === moves[index]);
}

export function validateExplorerParams(url) {
  const source = url.searchParams.get("source") || "masters";
  if (!["masters", "lichess", "combined"].includes(source)) throw new Error("invalid_source");
  const fen = normalizeExplorerFen(url.searchParams.get("fen") || "");
  const play = normalizeUciPlay(url.searchParams.get("play") || "");
  const moves = clampInteger(url.searchParams.get("moves"), 1, 20, 12);
  const topGames = clampInteger(url.searchParams.get("topGames"), 0, 15, source === "lichess" ? 4 : 15);
  const since = normalizeDateValue(url.searchParams.get("since"), source === "lichess" ? "1952-01" : "1952", source === "masters" ? "year" : "month");
  const until = normalizeDateValue(url.searchParams.get("until"), source === "lichess" ? "3000-12" : "3000", source === "masters" ? "year" : "month");
  const speeds = normalizeCsv(url.searchParams.get("speeds"), ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"]);
  const ratings = normalizeCsv(url.searchParams.get("ratings"), ["0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500"]);
  return { source, fen, play, moves, topGames, since, until, speeds, ratings };
}

function normalizeDateValue(value, fallback, granularity = "month") {
  if (!value) return fallback;
  const normalized = String(value).trim();
  if (granularity === "year") {
    if (!/^\d{4}$/.test(normalized)) throw new Error("invalid_date_filter");
    return normalized;
  }
  if (!/^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2]))$/.test(normalized)) throw new Error("invalid_date_filter");
  return normalized;
}

function normalizeCsv(value, allowed) {
  if (!value) return [];
  const values = String(value).split(",").map(item => item.trim()).filter(Boolean);
  if (values.length > allowed.length) throw new Error("too_many_filters");
  const dedupe = [...new Set(values)];
  if (dedupe.some(item => !allowed.includes(item))) throw new Error("invalid_filter");
  return dedupe;
}

function clampInteger(value, min, max, fallback) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error("invalid_integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("invalid_integer");
  return Math.max(min, Math.min(max, number));
}

export function buildExplorerRequest({ source, fen, play, since, until, moves, topGames, speeds, ratings }) {
  const path = source === "lichess" ? "/lichess" : "/masters";
  const url = new URL(`${EXPLORER_BASE}${path}`);
  url.searchParams.set("variant", "standard");
  url.searchParams.set("fen", fen);
  if (play.length) url.searchParams.set("play", play.join(","));
  url.searchParams.set("moves", String(moves));
  url.searchParams.set("topGames", String(Math.min(topGames, source === "lichess" ? 4 : 15)));
  if (since) url.searchParams.set("since", since);
  if (until) url.searchParams.set("until", until);
  if (source === "lichess") {
    if (speeds.length) url.searchParams.set("speeds", speeds.join(","));
    if (ratings.length) url.searchParams.set("ratings", ratings.join(","));
  }
  return url;
}

export function normalizeExplorerResponse(raw, source = "masters") {
  const safeSource = source === "lichess" ? "lichess" : "masters";
  const normalizeGame = (game) => {
    if (!game || typeof game !== "object") return null;
    const id = String(game.id || "").trim();
    if (!id) return null;
    return { ...game, id, source: safeSource };
  };
  const moves = Array.isArray(raw?.moves) ? raw.moves.slice(0, 20).map(move => ({
    uci: String(move?.uci || ""),
    san: String(move?.san || ""),
    averageRating: Number.isFinite(Number(move?.averageRating))
      ? Number(move.averageRating)
      : Number.isFinite(Number(move?.averageOpponentRating))
        ? Number(move.averageOpponentRating)
        : null,
    performance: Number.isFinite(Number(move?.performance)) ? Number(move.performance) : null,
    white: Number(move?.white || 0),
    draws: Number(move?.draws || 0),
    black: Number(move?.black || 0),
    game: normalizeGame(move?.game),
    opening: move?.opening || null,
  })).filter(move => move.uci && move.san) : [];
  return {
    opening: raw?.opening || null,
    white: Number(raw?.white || 0),
    draws: Number(raw?.draws || 0),
    black: Number(raw?.black || 0),
    moves,
    topGames: Array.isArray(raw?.topGames) ? raw.topGames.slice(0, 15).map(normalizeGame).filter(Boolean) : [],
    recentGames: Array.isArray(raw?.recentGames) ? raw.recentGames.slice(0, 8).map(normalizeGame).filter(Boolean) : [],
  };
}

export function mergeExplorerResponses(a, b, limit = 12) {
  const left = a || {};
  const right = b || {};
  const moves = new Map();
  for (const source of [left.moves || [], right.moves || []]) {
    for (const move of source) {
      const current = moves.get(move.uci) || {
        uci: move.uci,
        san: move.san,
        white: 0,
        draws: 0,
        black: 0,
        averageRatingSum: 0,
        averageRatingCount: 0,
        game: null,
        opening: move.opening || null,
      };
      current.white += Number(move.white || 0);
      current.draws += Number(move.draws || 0);
      current.black += Number(move.black || 0);
      const count = Number(move.white || 0) + Number(move.draws || 0) + Number(move.black || 0);
      const rating = Number(move.averageRating);
      if (Number.isFinite(rating) && count > 0) {
        current.averageRatingSum += rating * count;
        current.averageRatingCount += count;
      }
      if (!current.game && move.game) current.game = move.game;
      if (!current.opening && move.opening) current.opening = move.opening;
      moves.set(move.uci, current);
    }
  }
  const mergedMoves = [...moves.values()]
    .map(move => ({
      ...move,
      averageRating: move.averageRatingCount ? Math.round(move.averageRatingSum / move.averageRatingCount) : null,
    }))
    .sort((x, y) => (y.white + y.draws + y.black) - (x.white + x.draws + x.black) || x.san.localeCompare(y.san))
    .slice(0, limit);
  const games = new Map();
  for (const source of [left.topGames || [], right.topGames || []]) {
    for (const game of source) if (game?.id) games.set(`${game.source || "masters"}:${game.id}`, game);
  }
  return {
    opening: left.opening || right.opening || null,
    white: Number(left.white || 0) + Number(right.white || 0),
    draws: Number(left.draws || 0) + Number(right.draws || 0),
    black: Number(left.black || 0) + Number(right.black || 0),
    moves: mergedMoves,
    topGames: [...games.values()].slice(0, 15),
  };
}
