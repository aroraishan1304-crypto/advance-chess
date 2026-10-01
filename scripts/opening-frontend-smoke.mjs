import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = await fs.readFile(path.join(root, "public", "chess.html"), "utf8");
const js = await fs.readFile(path.join(root, "public", "openings", "openings.js"), "utf8");
const css = await fs.readFile(path.join(root, "public", "openings", "openings.css"), "utf8");

assert.match(html, /id=["']openingView["']/);
assert.match(html, /data-opening-entry=["']true["']/);
assert.match(html, /src=["'][^"']*openings\/openings\.js\?v=[^"']+["']/);
assert.match(html, /href=["'][^"']*openings\/openings\.css["']/);
assert.match(html, /Opening Atlas/);

assert.match(js, /AbortController/);
assert.match(js, /Other legal moves/);
assert.match(js, /No indexed games/);
assert.match(js, /repertoireToggle/);
assert.match(js, /practiceStats/);
assert.doesNotMatch(js, /innerHTML\s*=/);
assert.doesNotMatch(js, /insertAdjacentHTML/);
assert.match(js, /\/api\/openings\/catalog/);
assert.match(js, /\/api\/openings\/explorer/);
assert.match(js, /\/api\/openings\/game-pgn/);
assert.match(js, /window\.closeOpeningAtlas/);

assert.match(css, /\.opening-screen/);
assert.match(css, /\.opening-modal::backdrop/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /\.opening-explorer-panel/);

console.log("PASS: opening atlas frontend smoke checks");
