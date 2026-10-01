import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENING_DATA_BASE,
  OPENING_DATA_FILES,
  buildOpeningCatalog,
  MAX_CATALOG_SOURCE_BYTES,
  MAX_TOTAL_CATALOG_BYTES,
} from "../src/openings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "openings", "catalog.json");
const USER_AGENT = "Advanced-Chess-Opening-Atlas-build/1.0";
const attempts = 3;

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/tab-separated-values,text/plain;q=0.9,*/*;q=0.1",
          "user-agent": USER_AGENT,
        },
      });
      if (!response.ok) throw new Error(`opening_source_${response.status}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > MAX_CATALOG_SOURCE_BYTES) throw new Error("opening_source_too_large");
      const text = await response.text();
      if (text.length > MAX_CATALOG_SOURCE_BYTES) throw new Error("opening_source_too_large");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error("opening_source_unavailable");
}

const textByFile = {};
let totalBytes = 0;
for (const file of OPENING_DATA_FILES) {
  const text = await fetchText(`${OPENING_DATA_BASE}/${file}`);
  totalBytes += Buffer.byteLength(text, "utf8");
  if (totalBytes > MAX_TOTAL_CATALOG_BYTES) throw new Error("opening_catalog_too_large");
  textByFile[file] = text;
}

const openings = buildOpeningCatalog(textByFile).map(entry => ({
  id: entry.id,
  eco: entry.eco,
  name: entry.name,
  pgn: entry.pgn,
  uci: entry.uci,
  epd: entry.epd,
}));

if (openings.length < 3000) throw new Error(`opening_catalog_incomplete:${openings.length}`);

const payload = {
  version: `lichess-chess-openings:${new Date().toISOString().slice(0, 10)}`,
  source: "https://github.com/lichess-org/chess-openings",
  license: "CC0-1.0",
  count: openings.length,
  openings,
};

await fs.writeFile(output, `${JSON.stringify(payload)}\n`, "utf8");
console.log(`Wrote ${openings.length} openings to ${path.relative(root, output)}`);
