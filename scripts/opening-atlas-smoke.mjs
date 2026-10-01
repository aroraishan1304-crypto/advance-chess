import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  OPENING_DATA_FILES,
  buildExplorerRequest,
  buildOpeningCatalog,
  identifyOpening,
  mergeExplorerResponses,
  normalizeExplorerFen,
  normalizeExplorerResponse,
  normalizeUciPlay,
  openingSearchResults,
  parseOpeningTsv,
  validateExplorerParams,
} from "../src/openings.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const fixture = [
  "eco\tname\tpgn",
  "C50\tItalian Game\t1. e4 e5 2. Nf3 Nc6 3. Bc4",
  "B90\tSicilian Defense: Najdorf Variation\t1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6",
  "D35\tQueen's Gambit Declined: Exchange Variation\t1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5",
].join("\n");

assert.equal(parseOpeningTsv(fixture, "fixture.tsv").length, 3);
const catalog = buildOpeningCatalog(Object.fromEntries(OPENING_DATA_FILES.map(file => [file, file === "a.tsv" ? fixture : "eco\tname\tpgn\n"])));
assert.equal(catalog.length, 3);
assert.equal(openingSearchResults(catalog, "Najdorf")[0].eco, "B90");
assert.deepEqual(normalizeUciPlay("e2e4,c7c5,g1f3"), ["e2e4", "c7c5", "g1f3"]);
assert.throws(() => normalizeUciPlay("e2e4,bad"), /invalid_uci/);
const startFen = normalizeExplorerFen("");
assert.match(startFen, /^rnbqkbnr\//);
const identified = identifyOpening(catalog, "e2e4,e7e5,g1f3,b8c6,f1c4");
assert.equal(identified.opening?.eco, "C50");
const transposed = identifyOpening(catalog, "g1f3,b8c6,e2e4,e7e5,f1c4");
assert.equal(transposed.opening?.eco, "C50");
assert.equal(transposed.transposition, true);
assert.throws(() => normalizeExplorerFen("not a fen"), /invalid_fen/);
assert.throws(() => normalizeUciPlay("e2e4," + "a1a2,".repeat(160)), /play_too_long/);
const explorerUrl = buildExplorerRequest({
  source: "masters",
  fen: startFen,
  play: ["e2e4"],
  since: "1952",
  until: "3000",
  moves: 12,
  topGames: 15,
  speeds: [],
  ratings: [],
});
assert.equal(explorerUrl.hostname, "explorer.lichess.org");
assert.equal(explorerUrl.pathname, "/masters");
assert.equal(explorerUrl.searchParams.get("play"), "e2e4");
assert.throws(() => validateExplorerParams(new URL("https://example.test/api/openings/explorer?source=masters&since=2020-01")), /invalid_date_filter/);
const validated = validateExplorerParams(new URL("https://example.test/api/openings/explorer?source=lichess&play=e2e4,e7e5&speeds=blitz,rapid&ratings=1800,2000"));
assert.deepEqual(validated.play, ["e2e4", "e7e5"]);
assert.deepEqual(validated.speeds, ["blitz", "rapid"]);
assert.deepEqual(validated.ratings, ["1800", "2000"]);
const merged = mergeExplorerResponses(
  { white: 5, draws: 2, black: 3, moves: [{ uci: "e2e4", san: "e4", white: 5, draws: 2, black: 3, averageRating: 1800 }] },
  { white: 2, draws: 1, black: 2, moves: [{ uci: "e2e4", san: "e4", white: 2, draws: 1, black: 2, averageRating: 2000 }] },
);
assert.equal(merged.white, 7);
assert.equal(merged.moves[0].white, 7);
assert.equal(merged.moves[0].averageRating, 1867);
const normalizedMastersGame = normalizeExplorerResponse({ topGames: [{ id: "abc12345", white: { name: "A" }, black: { name: "B" } }] }, "masters");
assert.equal(normalizedMastersGame.topGames[0].source, "masters");
const normalizedLichessGame = normalizeExplorerResponse({ topGames: [{ id: "def67890" }] }, "lichess");
assert.equal(normalizedLichessGame.topGames[0].source, "lichess");
await fs.access(path.join(root, "public", "chess.html"));
const worker = await fs.readFile(path.join(root, "src", "index.js"), "utf8");
assert.match(worker, /readStaticOpeningCatalog/);
assert.doesNotMatch(worker, /raw\.githubusercontent\.com/);
assert.match(worker, /opening_catalog_asset_missing/);
assert.match(worker, /https:\/\/lichess\.org\/game\/export/);
console.log("PASS: opening atlas backend smoke checks");
