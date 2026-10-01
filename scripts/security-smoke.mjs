import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFile(new URL(file, import.meta.url), "utf8");
const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};

const index = await read("../src/index.js");
const account = await read("../src/account/account.js");
const bridge = await read("../public/account/bridge.js");
const chess = await read("../public/chess.html");
const accountUi = await read("../public/account/account.js");
const migration = await read("../migrations/0005_account_data_integrity.sql");

for (const file of [
  "../src/index.js",
  "../src/account/account.js",
  "../src/account/crypto.js",
  "../public/account/bridge.js",
  "../public/account/account.js",
]) {
  execFileSync(process.execPath, ["--check", fileURLToPath(new URL(file, import.meta.url))], { stdio: "inherit" });
}

assert(index.includes("return withSecurityHeaders(await createGame(request, env));"), "game creation responses receive global security headers");
assert(index.includes("if (accountResponse) return withSecurityHeaders(accountResponse);"), "account responses receive global security headers");
assert(index.includes('rateLimitGameRequest(request, env, "create", 12, 60);'), "game creation is edge-rate-limited");
assert(index.includes('rateLimitGameRequest(request, env, "join", 60, 60);'), "game joining is edge-rate-limited");
assert(account.includes('if (route === "/guest/migrate" && method === "POST")'), "guest migration endpoint is wired");
assert(account.includes('if (route === "/game-result" && method === "POST")'), "client game-result endpoint is wired");
assert(account.includes('if (route === "/puzzle-result" && method === "POST")'), "client puzzle-result endpoint is wired");
assert(!account.includes('/internal/guest-game-result') && !account.includes('/internal/guest-puzzle-result'), "legacy internal guest-result endpoints are removed");
assert(!account.includes('X-Account-Internal'), "legacy internal account secret path is removed");
assert(bridge.includes('recordClientResult("/game-result"'), "browser bridge posts game results");
assert(bridge.includes('recordClientResult("/puzzle-result"'), "browser bridge posts puzzle results");
assert(bridge.includes('RESULT_OUTBOX_KEY'), "browser bridge has a durable retry outbox for result delivery");
assert(bridge.includes('flushResultOutbox'), "browser bridge retries queued results when connectivity returns");
assert(chess.includes('window.acAccount?.recordGameResult?.('), "chess client records completed games");
assert(chess.includes('window.acAccount?.recordPuzzleResult?.('), "chess client records puzzle attempts");
assert(chess.includes('difficulty === "standard" ? 24 : difficulty === "hard" ? 32 : 38'), "chess client uses standard/hard/extra-hard puzzle weighting");
assert(account.includes('rawDifficulty === "extraHard" || rawDifficulty === "hardest"'), "server accepts the client extra-hard puzzle mode and legacy hardest alias");
assert(accountUi.includes("async function refreshData()"), "account UI refresh function exists");
assert(accountUi.includes("function renderRoute()"), "account UI route renderer exists");
assert(accountUi.includes("function openDelete()"), "account deletion UI exists");
assert(accountUi.includes("function blockUser("), "block UI handler exists");
assert(accountUi.includes("function reportUser("), "report UI handler exists");
assert(accountUi.includes('await refreshData();\n      toast(\n        d.migrated'), "manual guest migration refreshes account state");
assert(migration.includes('migrated_to_user_id'), "guest migration keeps a durable link for in-flight games");
assert(migration.includes('idx_puzzle_history_attempt ON puzzle_rating_history(user_id, attempt_id)'), "puzzle attempts use per-user idempotency");
assert(index.includes("account_recorded INTEGER NOT NULL DEFAULT 0"), "friend-game result recording has durable outbox state");
assert(index.includes("await this.recordFinishedGame(state"), "authoritative game finishes trigger account recording");
assert(!account.includes('async function internalPuzzleResult'), "obsolete internal puzzle result handler is removed");
assert(!account.includes('async function internalGuestGameResult'), "obsolete internal guest game handler is removed");
assert(!account.includes('async function internalGuestPuzzleResult'), "obsolete internal guest puzzle handler is removed");
assert(account.includes('UPDATE email_tokens SET used_at=? WHERE id=? AND used_at IS NULL'), "email tokens are atomically consumed");
assert(account.includes('UPDATE email_tokens SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?'), "reset/email-change tokens cannot be concurrently reused");

console.log(`PASS: ${checks.length} hardening smoke checks`);
