import { Chess } from "../vendor/chess.js";

const START_FEN = new Chess().fen();
const PAGE_SIZE = 60;
const MAX_CATALOG = 20_000;
const REPERTOIRE_KEY = "advanced-chess-opening-repertoire-v1";
const PRACTICE_KEY = "advanced-chess-opening-practice-v1";

const state = {
  ready: false,
  catalog: [],
  catalogMap: new Map(),
  filtered: [],
  page: 0,
  query: "",
  eco: "all",
  showRepertoireOnly: false,
  selected: null,
  chess: new Chess(),
  moves: [],
  baseMoves: [],
  selectedSquare: null,
  orientation: "white",
  source: "masters",
  explorer: null,
  loadingCatalog: false,
  loadingExplorer: false,
  explorerError: "",
  identity: null,
  explorerRequestId: 0,
  explorerAbortController: null,
  filters: {
    speeds: [],
    ratings: [],
    since: "1952",
    until: "3000",
  },
  practice: null,
  repertoire: loadRepertoire(),
  practiceStats: loadPracticeStats(),
};

let root = null;
let boardElement = null;
let libraryElement = null;
let searchElement = null;
let ecoElement = null;
let pageElement = null;
let explorerMovesElement = null;
let explorerGamesElement = null;
let currentOpeningElement = null;
let currentLineElement = null;
let statusElement = null;
let sourceElement = null;
let ratingElement = null;
let speedElement = null;
let sinceElement = null;
let untilElement = null;
let detailElement = null;
let practiceElement = null;
let dialogElement = null;
let promotionElement = null;

function qs(selector) {
  return document.querySelector(selector);
}

function create(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text != null) element.textContent = options.text;
  if (options.id) element.id = options.id;
  if (options.type) element.type = options.type;
  if (options.title) element.title = options.title;
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.hidden != null) element.hidden = options.hidden;
  return element;
}

function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function loadRepertoire() {
  try {
    const raw = localStorage.getItem(REPERTOIRE_KEY);
    const data = JSON.parse(raw || "[]");
    return new Set(Array.isArray(data) ? data.filter(item => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveRepertoire() {
  try {
    localStorage.setItem(REPERTOIRE_KEY, JSON.stringify([...state.repertoire]));
  } catch {}
}

function loadPracticeStats() {
  try {
    const raw = localStorage.getItem(PRACTICE_KEY);
    const data = JSON.parse(raw || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function savePracticeStats() {
  try {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(state.practiceStats));
  } catch {}
}

function recordPracticeAttempt(openingId, completed = false) {
  if (!openingId) return;
  const current = state.practiceStats[openingId] || { attempts: 0, completions: 0 };
  current.attempts = Number(current.attempts || 0) + 1;
  if (completed) current.completions = Number(current.completions || 0) + 1;
  state.practiceStats[openingId] = current;
  savePracticeStats();
}

function totalGames(data) {
  return Number(data?.white || 0) + Number(data?.draws || 0) + Number(data?.black || 0);
}

function pct(value, total) {
  if (!total) return "0.0%";
  return `${((Number(value || 0) / total) * 100).toFixed(1)}%`;
}

function toUci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function sanLine(chess) {
  return chess.history();
}

function formatLine(moves) {
  const sans = moves.map(move => move.san).filter(Boolean);
  const parts = [];
  for (let i = 0; i < sans.length; i += 2) {
    parts.push(`${Math.floor(i / 2) + 1}.${sans[i]}${sans[i + 1] ? ` ${sans[i + 1]}` : ""}`);
  }
  return parts.join(" ");
}

function fileRank(square) {
  return {
    file: square.charCodeAt(0) - 97,
    rank: Number(square[1]) - 1,
  };
}

function orderedSquares() {
  const files = state.orientation === "white" ? ["a", "b", "c", "d", "e", "f", "g", "h"] : ["h", "g", "f", "e", "d", "c", "b", "a"];
  const ranks = state.orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const squares = [];
  for (const rank of ranks) for (const file of files) squares.push(`${file}${rank}`);
  return squares;
}

function showOpening() {
  root?.classList.remove("hidden");
  root?.classList.add("show");
  root?.setAttribute("aria-hidden", "false");
  qs("#homeView")?.classList.add("hidden");
  qs("#gameView")?.classList.remove("show");
  qs("#puzzleView")?.classList.remove("show");
  document.querySelectorAll(".home-nav-button[data-home-nav]").forEach(button => button.classList.toggle("active", button.dataset.homeNav === "openings"));
  loadCatalogOnce();
}

function closeOpening() {
  if (!root) return;
  state.explorerAbortController?.abort();
  state.explorerAbortController = null;
  state.explorerRequestId += 1;
  root.classList.remove("show");
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  qs("#homeView")?.classList.remove("hidden");
  qs("#gameView")?.classList.remove("show");
  qs("#puzzleView")?.classList.remove("show");
  document.querySelectorAll(".home-nav-button[data-home-nav]").forEach(button => button.classList.toggle("active", button.dataset.homeNav === "home"));
  window.scrollTo({ top: 0, behavior: "auto" });
}

function buildShell() {
  root = qs("#openingView");
  if (!root) return;
  clear(root);

  const appbar = create("header", { className: "opening-appbar" });
  const back = create("button", { className: "opening-home-button", type: "button", text: "⌂ Home", ariaLabel: "Return to home" });
  back.addEventListener("click", closeOpening);
  const titleBlock = create("div", { className: "opening-title-block" });
  const kicker = create("div", { className: "opening-kicker", text: "OPENING ATLAS" });
  const title = create("h1", { text: "Explore chess openings" });
  const subtitle = create("p", { text: "Browse named openings, explore real continuation data, follow variations, review model games, and practice lines." });
  titleBlock.append(kicker, title, subtitle);
  const count = create("span", { className: "opening-count" });
  const credits = create("span", { className: "opening-data-credit", text: "Opening names: Lichess chess-openings (CC0) · Explorer: Lichess Opening Explorer" });
  const toolbar = create("div", { className: "opening-appbar-right" });
  toolbar.append(count, credits);
  appbar.append(back, titleBlock, toolbar);

  const workspace = create("main", { className: "opening-workspace" });
  const library = create("aside", { className: "opening-library" });
  const libraryHead = create("div", { className: "opening-panel-head" });
  const libraryTitleRow = create("div", { className: "opening-library-title-row" });
  const libraryTitle = create("div", { className: "opening-panel-title", text: "Opening library" });
  const repertoireToggle = create("button", { className: "opening-small-button", type: "button", text: "☆ Repertoire" });
  repertoireToggle.addEventListener("click", () => {
    state.showRepertoireOnly = !state.showRepertoireOnly;
    repertoireToggle.textContent = state.showRepertoireOnly ? "★ Repertoire" : "☆ Repertoire";
    state.page = 0;
    renderLibrary();
  });
  libraryTitleRow.append(libraryTitle, repertoireToggle);
  const searchWrap = create("label", { className: "opening-search-wrap" });
  searchElement = create("input", { type: "search", ariaLabel: "Search openings" });
  searchElement.placeholder = "Search name, ECO, or move...";
  searchElement.autocomplete = "off";
  searchWrap.append(searchElement);
  libraryHead.append(libraryTitleRow, searchWrap);

  const ecoBar = create("div", { className: "opening-eco-bar" });
  const ecoValues = [["all", "All"], ["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"]];
  for (const [value, label] of ecoValues) {
    const button = create("button", { className: "opening-filter-chip", type: "button", text: label });
    button.dataset.eco = value;
    button.addEventListener("click", () => {
      state.eco = value;
      state.page = 0;
      renderLibrary();
    });
    ecoBar.append(button);
  }

  libraryElement = create("div", { className: "opening-library-list", ariaLabel: "Opening catalogue" });
  const pageControls = create("div", { className: "opening-page-controls" });
  const prev = create("button", { className: "opening-small-button", type: "button", text: "← Previous" });
  const next = create("button", { className: "opening-small-button", type: "button", text: "Next →" });
  pageElement = create("span", { className: "opening-page-label" });
  prev.addEventListener("click", () => { if (state.page > 0) { state.page -= 1; renderLibrary(); } });
  next.addEventListener("click", () => { if ((state.page + 1) * PAGE_SIZE < state.filtered.length) { state.page += 1; renderLibrary(); } });
  pageControls.append(prev, pageElement, next);
  library.append(libraryHead, ecoBar, libraryElement, pageControls);

  const center = create("section", { className: "opening-board-column" });
  const boardHeader = create("div", { className: "opening-board-header" });
  currentOpeningElement = create("div", { className: "opening-current-title", text: "Starting position" });
  currentLineElement = create("div", { className: "opening-current-line", text: "Play a move or select an opening." });
  boardHeader.append(currentOpeningElement, currentLineElement);
  boardElement = create("div", { className: "opening-board", ariaLabel: "Opening exploration board" });
  const boardToolbar = create("div", { className: "opening-board-toolbar" });
  for (const [label, handler] of [
    ["↶ Undo", undoMove],
    ["↻ Reset", resetToBase],
    ["⇄ Flip", flipBoard],
    ["Practice line", startPractice],
  ]) {
    const button = create("button", { className: "opening-toolbar-button", type: "button", text: label });
    button.addEventListener("click", handler);
    boardToolbar.append(button);
  }
  const boardNote = create("div", { className: "opening-board-note", text: "Click a piece, then a legal destination. Promotion choices appear when needed." });
  practiceElement = create("div", { className: "opening-practice-panel", hidden: true });
  center.append(boardHeader, boardElement, boardToolbar, boardNote, practiceElement);

  const explorer = create("aside", { className: "opening-explorer-panel" });
  const explorerHead = create("div", { className: "opening-panel-head" });
  const explorerTitle = create("div", { className: "opening-panel-title", text: "Explorer" });
  sourceElement = create("select", { ariaLabel: "Explorer source" });
  for (const [value, label] of [["masters", "Masters"], ["lichess", "Lichess"], ["combined", "Combined"]]) {
    const option = create("option", { text: label }); option.value = value; sourceElement.append(option);
  }
  sourceElement.addEventListener("change", () => {
    state.source = sourceElement.value;
    loadExplorer();
  });
  explorerHead.append(explorerTitle, sourceElement);

  const filterDetails = create("details", { className: "opening-filters" });
  const filterSummary = create("summary", { text: "Explorer filters" });
  const filterGrid = create("div", { className: "opening-filter-grid" });
  ratingElement = create("select", { ariaLabel: "Rating filter" });
  for (const [value, label] of [["", "All ratings"], ["0", "0–999"], ["1000", "1000–1199"], ["1200", "1200–1399"], ["1400", "1400–1599"], ["1600", "1600–1799"], ["1800", "1800–1999"], ["2000", "2000–2199"], ["2200", "2200–2499"], ["2500", "2500+"]]) {
    const option = create("option", { text: label }); option.value = value; ratingElement.append(option);
  }
  speedElement = create("select", { ariaLabel: "Speed filter" });
  for (const [value, label] of [["", "All speeds"], ["bullet", "Bullet"], ["blitz", "Blitz"], ["rapid", "Rapid"], ["classical", "Classical"], ["correspondence", "Correspondence"], ["ultraBullet", "UltraBullet"]]) {
    const option = create("option", { text: label }); option.value = value; speedElement.append(option);
  }
  sinceElement = create("input", { type: "number", ariaLabel: "Games since year" }); sinceElement.min = "1952"; sinceElement.max = "3000"; sinceElement.value = state.filters.since;
  untilElement = create("input", { type: "number", ariaLabel: "Games until year" }); untilElement.min = "1952"; untilElement.max = "3000"; untilElement.value = state.filters.until;
  filterGrid.append(field("Rating group", ratingElement), field("Speed", speedElement), field("Since", sinceElement), field("Until", untilElement));
  filterDetails.append(filterSummary, filterGrid);

  const status = create("div", { className: "opening-explorer-status" });
  statusElement = status;
  detailElement = create("div", { className: "opening-detail-card" });
  explorerMovesElement = create("div", { className: "opening-moves" });
  explorerGamesElement = create("div", { className: "opening-games" });
  explorer.append(explorerHead, filterDetails, status, detailElement, sectionBox("Common continuations", explorerMovesElement), sectionBox("Model games", explorerGamesElement));

  workspace.append(library, center, explorer);
  root.append(appbar, workspace);

  searchElement.addEventListener("input", () => {
    state.query = searchElement.value;
    state.page = 0;
    renderLibrary();
  });
  for (const element of [ratingElement, speedElement, sinceElement, untilElement]) {
    element.addEventListener("change", () => {
      state.filters.ratings = ratingElement.value ? [ratingElement.value] : [];
      state.filters.speeds = speedElement.value ? [speedElement.value] : [];
      state.filters.since = sinceElement.value || "1952";
      state.filters.until = untilElement.value || "3000";
      loadExplorer();
    });
  }

  dialogElement = create("dialog", { className: "opening-modal" });
  dialogElement.setAttribute("aria-labelledby", "openingModalTitle");
  const dialogCard = create("div", { className: "opening-modal-card" });
  const dialogClose = create("button", { className: "opening-modal-close", type: "button", text: "×", ariaLabel: "Close" });
  const dialogTitle = create("h2", { id: "openingModalTitle", text: "Model game" });
  const dialogBody = create("pre", { className: "opening-modal-body" });
  dialogClose.addEventListener("click", () => dialogElement.close());
  dialogElement.addEventListener("click", event => { if (event.target === dialogElement) dialogElement.close(); });
  dialogCard.append(dialogClose, dialogTitle, dialogBody);
  dialogElement.append(dialogCard);
  document.body.append(dialogElement);
  dialogElement._body = dialogBody;
  dialogElement._title = dialogTitle;

  promotionElement = create("div", { className: "opening-promotion", hidden: true });
  for (const promotion of ["q", "r", "b", "n"]) {
    const button = create("button", { type: "button", text: promotion.toUpperCase() });
    button.addEventListener("click", () => choosePromotion(promotion));
    promotionElement.append(button);
  }
  boardElement.append(promotionElement);
}

function field(label, element) {
  const wrap = create("label", { className: "opening-filter-field" });
  wrap.append(create("span", { text: label }), element);
  return wrap;
}

function sectionBox(title, body) {
  const wrap = create("section", { className: "opening-subpanel" });
  wrap.append(create("h3", { text: title }), body);
  return wrap;
}

async function loadCatalogOnce() {
  if (state.ready || state.loadingCatalog) return;
  state.loadingCatalog = true;
  renderLoadingState();
  try {
    const response = await fetch("/api/openings/catalog", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`catalog_${response.status}`);
    const data = await response.json();
    const openings = Array.isArray(data?.openings) ? data.openings : [];
    if (!openings.length || openings.length > MAX_CATALOG) throw new Error("invalid_catalog");
    state.catalog = openings;
    state.catalogMap = new Map(openings.map(opening => [opening.id, opening]));
    state.ready = true;
    const count = qs(".opening-count");
    if (count) count.textContent = `${data.count || openings.length} named entries`;
    renderLibrary();
    renderBoard();
    renderDetails();
    await loadExplorer();
  } catch (error) {
    state.explorerError = "The opening catalogue could not be loaded. The Explorer will retry when you reopen this tool.";
    state.loadingCatalog = false;
    renderLoadingState(error?.message || "catalog_error");
    return;
  }
  state.loadingCatalog = false;
}

function renderLoadingState(message = "Loading opening catalogue…") {
  if (libraryElement) {
    clear(libraryElement);
    libraryElement.append(create("div", { className: "opening-empty", text: message }));
  }
  if (statusElement) statusElement.textContent = message;
}

function renderLibrary() {
  if (!state.ready || !libraryElement) return;
  const query = state.query.trim().toLowerCase();
  state.filtered = state.catalog.filter(opening => {
    if (state.showRepertoireOnly && !state.repertoire.has(opening.id)) return false;
    if (state.eco !== "all" && !opening.eco.startsWith(state.eco)) return false;
    if (!query) return true;
    return `${opening.name} ${opening.eco} ${opening.pgn}`.toLowerCase().includes(query);
  });
  const start = state.page * PAGE_SIZE;
  const page = state.filtered.slice(start, start + PAGE_SIZE);
  clear(libraryElement);
  if (!page.length) {
    libraryElement.append(create("div", { className: "opening-empty", text: "No openings match that search." }));
  }
  for (const opening of page) {
    const button = create("button", { className: "opening-library-item", type: "button" });
    button.classList.toggle("selected", state.selected?.id === opening.id);
    const title = create("strong", { text: opening.name });
    const meta = create("span", { text: `${opening.eco} · ${opening.pgn}` });
    button.append(title, meta);
    button.addEventListener("click", () => selectOpening(opening));
    libraryElement.append(button);
  }
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  pageElement.textContent = `${Math.min(state.page + 1, pageCount)} / ${pageCount} · ${state.filtered.length.toLocaleString()} results`;
  ecoElement = ecoElement || root.querySelectorAll(".opening-filter-chip");
  for (const chip of ecoElement || []) chip.classList.toggle("active", chip.dataset.eco === state.eco);
}

function selectOpening(opening) {
  state.selected = opening;
  state.practice = null;
  loadBaseLine(opening.uci?.split(/\s+/).filter(Boolean) || []);
  renderLibrary();
  renderDetails();
  loadExplorer();
}

function loadBaseLine(uciMoves) {
  const chess = new Chess();
  const actual = [];
  for (const uci of uciMoves) {
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      actual.push({ uci, san: move.san, from: move.from, to: move.to, promotion: move.promotion || null });
    } catch {
      break;
    }
  }
  state.chess = chess;
  state.moves = actual;
  state.baseMoves = actual.map(move => ({ ...move }));
  state.selectedSquare = null;
  renderBoard();
}

function resetToBase() {
  loadBaseLine(state.baseMoves.map(move => move.uci));
  renderDetails();
  loadExplorer();
}

function undoMove() {
  if (state.moves.length <= state.baseMoves.length) return;
  const target = state.moves.length - 1;
  const chess = new Chess();
  for (let i = 0; i < target; i += 1) {
    const move = state.moves[i];
    chess.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
  }
  state.chess = chess;
  state.moves = state.moves.slice(0, target);
  state.selectedSquare = null;
  state.practice = null;
  renderBoard();
  renderDetails();
  loadExplorer();
}

function flipBoard() {
  state.orientation = state.orientation === "white" ? "black" : "white";
  renderBoard();
}

function renderBoard() {
  if (!boardElement) return;
  const oldPromotion = promotionElement;
  clear(boardElement);
  for (const square of orderedSquares()) {
    const squareElement = create("button", { className: "opening-square", type: "button" });
    const { file, rank } = fileRank(square);
    squareElement.classList.add((file + rank) % 2 === 0 ? "light" : "dark");
    const piece = state.chess.get(square);
    if (piece) {
      const pieceElement = create("span", { className: `opening-piece ${piece.color === "w" ? "white-piece" : "black-piece"}`, text: pieceGlyph(piece) });
      squareElement.append(pieceElement);
    }
    if (state.selectedSquare === square) squareElement.classList.add("selected");
    if (state.selectedSquare && legalTargets(state.selectedSquare).includes(square)) squareElement.classList.add("legal");
    squareElement.addEventListener("click", () => boardClick(square));
    boardElement.append(squareElement);
  }
  promotionElement = oldPromotion;
  if (promotionElement) {
    promotionElement.hidden = !state.pendingPromotion;
    boardElement.append(promotionElement);
  }
}

function pieceGlyph(piece) {
  return ({
    w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
    b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
  })[piece.color][piece.type];
}

function legalTargets(square) {
  try {
    return state.chess.moves({ square, verbose: true }).map(move => move.to);
  } catch {
    return [];
  }
}

function boardClick(square) {
  if (state.practice) return practiceClick(square);
  if (state.pendingPromotion) return;
  if (state.selectedSquare) {
    if (legalTargets(state.selectedSquare).includes(square)) {
      const move = state.chess.moves({ square: state.selectedSquare, verbose: true }).find(item => item.to === square);
      if (move?.promotion) {
        state.pendingPromotion = { from: state.selectedSquare, to: square };
        promotionElement.hidden = false;
        renderBoard();
        return;
      }
      applyMove(state.selectedSquare, square, move?.promotion);
      return;
    }
    state.selectedSquare = null;
  }
  const piece = state.chess.get(square);
  if (piece && piece.color === state.chess.turn()) state.selectedSquare = square;
  renderBoard();
}

function choosePromotion(promotion) {
  const pending = state.pendingPromotion;
  if (!pending) return;
  state.pendingPromotion = null;
  applyMove(pending.from, pending.to, promotion);
}

function applyMove(from, to, promotion) {
  try {
    const move = state.chess.move({ from, to, promotion });
    state.moves.push({ uci: toUci(move), san: move.san, from: move.from, to: move.to, promotion: move.promotion || null });
    state.selectedSquare = null;
    state.explorerError = "";
    renderBoard();
    renderDetails();
    loadExplorer();
  } catch (error) {
    state.explorerError = error?.message || "Illegal move";
    renderBoard();
    renderDetails();
  }
}

function renderDetails() {
  if (!currentOpeningElement || !currentLineElement || !detailElement) return;
  const current = state.explorer?.opening || state.selected;
  currentOpeningElement.textContent = current?.name || "Unclassified position";
  currentLineElement.textContent = state.moves.length ? formatLine(state.moves) : "Starting position";
  clear(detailElement);
  if (current) {
    const title = create("h2", { text: current.name });
    const meta = create("div", { className: "opening-detail-meta", text: `${current.eco || "—"} · ${currentOpeningElement.textContent}` });
    if (state.identity?.transposition) {
      const note = create("div", { className: "opening-transposition-note", text: "Transposition detected: this position reaches the named opening through a different move order." });
      detailElement.append(title, meta, note);
    }
    const line = create("pre", { className: "opening-detail-line", text: current.pgn || formatLine(state.moves) });
    const stats = state.practiceStats[current.id] || { attempts: 0, completions: 0 };
    const lesson = create("div", { className: "opening-detail-lesson" });
    lesson.append(
      create("strong", { text: "Study path" }),
      create("span", { text: "Learn the canonical line → inspect common continuations → review model games → practice the line." }),
      create("small", { text: `Practice: ${Number(stats.completions || 0).toLocaleString()} completed · ${Number(stats.attempts || 0).toLocaleString()} attempts` })
    );
    const actions = create("div", { className: "opening-detail-actions" });
    const favorite = create("button", { className: "opening-small-button", type: "button", text: state.repertoire.has(current.id) ? "★ In repertoire" : "☆ Add to repertoire" });
    favorite.addEventListener("click", () => toggleRepertoire(current));
    const copy = create("button", { className: "opening-small-button", type: "button", text: "Copy line" });
    copy.addEventListener("click", () => copyText(current.pgn || formatLine(state.moves)));
    const copyFen = create("button", { className: "opening-small-button", type: "button", text: "Copy FEN" });
    copyFen.addEventListener("click", () => copyText(state.chess.fen()));
    const reset = create("button", { className: "opening-small-button", type: "button", text: "Explore from start" });
    reset.addEventListener("click", () => {
      state.practice = null;
      state.chess = new Chess();
      state.moves = [];
      state.selectedSquare = null;
      renderBoard();
      renderDetails();
      loadExplorer();
    });
    actions.append(favorite, copy, copyFen, reset);
    if (state.identity?.transposition) detailElement.append(line, lesson, actions);
    else detailElement.append(title, meta, line, lesson, actions);
  } else {
    detailElement.append(create("p", { text: "Make moves to identify the opening automatically, or choose a catalogue entry." }));
  }
}

function toggleRepertoire(opening) {
  if (state.repertoire.has(opening.id)) state.repertoire.delete(opening.id);
  else state.repertoire.add(opening.id);
  saveRepertoire();
  renderDetails();
}

async function loadExplorer() {
  if (!state.ready) return;
  state.explorerRequestId += 1;
  const requestId = state.explorerRequestId;
  state.explorerAbortController?.abort();
  const controller = new AbortController();
  state.explorerAbortController = controller;
  state.loadingExplorer = true;
  state.explorerError = "";
  statusElement.textContent = "Loading continuation data…";
  const params = new URLSearchParams();
  params.set("source", state.source);
  params.set("fen", START_FEN);
  const play = state.moves.map(move => move.uci);
  if (play.length) params.set("play", play.join(","));
  params.set("moves", "20");
  params.set("topGames", "15");
  if (state.filters.since) params.set("since", state.filters.since);
  if (state.filters.until) params.set("until", state.filters.until);
  if (state.filters.speeds.length) params.set("speeds", state.filters.speeds.join(","));
  if (state.filters.ratings.length) params.set("ratings", state.filters.ratings.join(","));
  const explorerPromise = fetch(`/api/openings/explorer?${params.toString()}`, {
    headers: { accept: "application/json" },
    signal: controller.signal,
  });
  const identityPromise = play.length
    ? fetch(`/api/openings/identify?play=${encodeURIComponent(play.join(","))}`, { headers: { accept: "application/json" }, signal: controller.signal })
    : Promise.resolve(null);
  try {
    const [response, identityResponse] = await Promise.all([explorerPromise, identityPromise.catch(() => null)]);
    if (!response.ok) throw new Error(`explorer_${response.status}`);
    const data = await response.json();
    let identity = null;
    if (identityResponse?.ok) {
      try { identity = await identityResponse.json(); } catch {}
    }
    if (requestId !== state.explorerRequestId) return;
    state.explorer = data;
    state.identity = identity;
    statusElement.textContent = `${totalGames(data).toLocaleString()} games in this explorer slice${data.partial ? " · partial source" : ""}`;
    renderDetails();
    renderExplorerMoves();
    renderExplorerGames();
  } catch (error) {
    if (error?.name === "AbortError" || requestId !== state.explorerRequestId) return;
    state.explorer = null;
    state.identity = null;
    state.explorerError = "Continuation data is temporarily unavailable.";
    statusElement.textContent = state.explorerError;
    renderExplorerMoves();
    renderExplorerGames();
    renderDetails();
  } finally {
    if (requestId === state.explorerRequestId) {
      state.loadingExplorer = false;
      if (state.explorerAbortController === controller) state.explorerAbortController = null;
    }
  }
}

function renderExplorerMoves() {
  if (!explorerMovesElement) return;
  clear(explorerMovesElement);
  if (state.practice) {
    explorerMovesElement.append(create("div", { className: "opening-empty", text: "Exit practice to inspect live continuation statistics." }));
    return;
  }

  const dataMoves = Array.isArray(state.explorer?.moves) ? state.explorer.moves : [];
  const total = totalGames(state.explorer);
  const indexed = new Set();
  for (const move of dataMoves) {
    indexed.add(move.uci);
    appendExplorerMoveButton(explorerMovesElement, move, total, false);
  }

  const legal = legalMovesForExplorer();
  const other = legal.filter(move => !indexed.has(move.uci));
  if (other.length) {
    const details = create("details", { className: "opening-other-moves" });
    details.open = dataMoves.length === 0;
    const summaryText = dataMoves.length ? `Other legal moves · ${other.length}` : `All legal moves · ${other.length}`;
    const summary = create("summary", { text: summaryText });
    const body = create("div", { className: "opening-moves" });
    for (const move of other) appendExplorerMoveButton(body, move, total, true);
    details.append(summary, body);
    explorerMovesElement.append(details);
  }

  if (!dataMoves.length && !other.length) {
    explorerMovesElement.append(create("div", { className: "opening-empty", text: state.loadingExplorer ? "Loading…" : "No legal moves are available from this position." }));
  }
}

function legalMovesForExplorer() {
  try {
    return state.chess.moves({ verbose: true })
      .map(move => ({ uci: `${move.from}${move.to}${move.promotion || ""}`, san: move.san, white: 0, draws: 0, black: 0, averageRating: null }))
      .sort((a, b) => a.san.localeCompare(b.san));
  } catch {
    return [];
  }
}

function appendExplorerMoveButton(container, move, total, noData) {
  const button = create("button", { className: "opening-move-row", type: "button" });
  const main = create("span", { className: "opening-move-main" });
  const san = create("strong", { text: move.san });
  const opening = move.opening?.name ? create("small", { text: move.opening.name }) : null;
  if (opening) main.append(san, opening); else main.append(san);
  const metrics = create("span", { className: "opening-move-metrics" });
  if (noData) {
    metrics.append(create("span", { text: "No indexed games" }));
  } else {
    const count = Number(move.white || 0) + Number(move.draws || 0) + Number(move.black || 0);
    metrics.append(create("span", { text: `${count.toLocaleString()} · ${pct(count, total)}` }));
    if (count) metrics.append(create("span", { text: `W ${pct(move.white, count)} · D ${pct(move.draws, count)} · B ${pct(move.black, count)}` }));
    if (move.averageRating) metrics.append(create("span", { text: `avg ${move.averageRating}` }));
  }
  button.append(main, metrics);
  button.addEventListener("click", () => explorerMove(move.uci));
  container.append(button);
}

function explorerMove(uci) {
  try {
    const move = state.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    state.moves.push({ uci, san: move.san, from: move.from, to: move.to, promotion: move.promotion || null });
    state.selectedSquare = null;
    renderBoard();
    renderDetails();
    loadExplorer();
  } catch {
    state.explorerError = "The selected continuation could not be played from this position.";
    statusElement.textContent = state.explorerError;
  }
}

function renderExplorerGames() {
  if (!explorerGamesElement) return;
  clear(explorerGamesElement);
  if (state.practice) {
    explorerGamesElement.append(create("div", { className: "opening-empty", text: "Exit practice to inspect model games." }));
    return;
  }
  const games = Array.isArray(state.explorer?.topGames) ? state.explorer.topGames : [];
  if (!games.length) {
    explorerGamesElement.append(create("div", { className: "opening-empty", text: "No model-game references are available here." }));
    return;
  }
  for (const game of games) {
    const card = create("div", { className: "opening-game-row" });
    const players = `${game.white?.name || "White"} — ${game.black?.name || "Black"}`;
    const sourceLabel = game.source === "lichess" ? "Lichess" : "Masters";
    const meta = `${game.year || ""}${game.month ? `-${String(game.month).slice(-2)}` : ""} · ${game.winner || "draw"} · ${sourceLabel}`;
    const title = create("strong", { text: players });
    const info = create("small", { text: meta });
    const button = create("button", { className: "opening-small-button", type: "button", text: "View PGN" });
    button.addEventListener("click", () => openModelGame(game));
    card.append(title, info, button);
    explorerGamesElement.append(card);
  }
}

async function openModelGame(game) {
  if (!game?.id || !dialogElement) return;
  dialogElement._title.textContent = `${game.white?.name || "White"} — ${game.black?.name || "Black"}`;
  dialogElement._body.textContent = "Loading PGN…";
  dialogElement.showModal();
  try {
    const response = await fetch(`/api/openings/game-pgn?id=${encodeURIComponent(game.id)}&source=${encodeURIComponent(game.source || "masters")}`, { headers: { accept: "application/x-chess-pgn,text/plain" } });
    if (!response.ok) throw new Error("pgn_unavailable");
    dialogElement._body.textContent = await response.text();
  } catch {
    dialogElement._body.textContent = "The model game PGN is temporarily unavailable.";
  }
}

function startPractice() {
  const opening = state.selected || state.explorer?.opening;
  const currentLine = state.moves.map(move => move.uci);
  const expected = currentLine.length
    ? currentLine
    : String(opening?.uci || "").split(/\s+/).filter(Boolean);
  if (!expected.length) {
    showPracticeMessage("Select an opening or make a line to practice first.", false);
    return;
  }
  const practiceOpeningId = opening?.id || state.selected?.id || null;
  recordPracticeAttempt(practiceOpeningId, false);
  state.explorer = null;
  state.practice = { expected, index: 0, openingId: practiceOpeningId, chess: new Chess(), message: currentLine.length ? "Play the current explored line in order. You control both sides." : "Play the opening moves in order. You control both sides.", complete: false };
  state.chess = state.practice.chess;
  state.moves = [];
  state.baseMoves = [];
  state.selectedSquare = null;
  showPracticeMessage(state.practice.message, false);
  if (statusElement) statusElement.textContent = "Practice mode · exit practice to return to live explorer data.";
  renderBoard();
  renderDetails();
  renderExplorerMoves();
  renderExplorerGames();
}

function practiceClick(square) {
  const practice = state.practice;
  if (!practice || practice.complete || practice.index >= practice.expected.length) return;
  if (!state.selectedSquare) {
    const piece = state.chess.get(square);
    if (piece && piece.color === state.chess.turn()) state.selectedSquare = square;
    renderBoard();
    return;
  }
  if (!legalTargets(state.selectedSquare).includes(square)) {
    state.selectedSquare = null;
    renderBoard();
    return;
  }
  const candidates = state.chess.moves({ square: state.selectedSquare, verbose: true }).filter(move => move.to === square);
  const move = candidates[0];
  const expected = practice.expected[practice.index];
  const actual = move ? `${move.from}${move.to}${move.promotion || ""}` : "";
  if (actual !== expected) {
    showPracticeMessage(`Not the expected move. Try ${formatPracticeExpected(expected)}.`, true);
    state.selectedSquare = null;
    renderBoard();
    return;
  }
  const played = state.chess.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
  state.moves.push({ uci: expected, san: played.san, from: played.from, to: played.to, promotion: played.promotion || null });
  practice.index += 1;
  state.selectedSquare = null;
  if (practice.index >= practice.expected.length) {
    practice.complete = true;
    const current = state.practiceStats[practice.openingId] || { attempts: 0, completions: 0 };
    current.completions = Number(current.completions || 0) + 1;
    state.practiceStats[practice.openingId] = current;
    savePracticeStats();
    showPracticeMessage("Line complete. Excellent — you reproduced the full named line.", false);
  } else {
    showPracticeMessage(`Correct: ${played.san}. Continue with move ${practice.index + 1}.`, false);
  }
  renderBoard();
  renderDetails();
}

function formatPracticeExpected(uci) {
  try {
    const chess = new Chess();
    for (let i = 0; i < state.practice.index; i += 1) {
      const move = state.practice.expected[i];
      chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || undefined });
    }
    const target = state.practice.expected[state.practice.index];
    const move = chess.move({ from: target.slice(0, 2), to: target.slice(2, 4), promotion: target[4] || undefined });
    return move.san;
  } catch {
    return uci;
  }
}

function showPracticeMessage(message, error) {
  if (!practiceElement) return;
  practiceElement.hidden = false;
  clear(practiceElement);
  const title = create("strong", { text: "Practice line" });
  const body = create("span", { text: message });
  if (error) body.classList.add("error");
  const close = create("button", { className: "opening-small-button", type: "button", text: "Exit practice" });
  close.addEventListener("click", () => {
    state.practice = null;
    loadBaseLine(state.baseMoves.map(move => move.uci));
    practiceElement.hidden = true;
    renderDetails();
    loadExplorer();
  });
  practiceElement.append(title, body, close);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    statusElement.textContent = "Copied to clipboard.";
  } catch {
    statusElement.textContent = "Clipboard access is unavailable in this browser.";
  }
}

function wireEntries() {
  document.querySelectorAll("[data-opening-entry]").forEach(element => {
    element.addEventListener("click", event => {
      event.preventDefault();
      showOpening();
    });
  });
}

export function initializeOpeningAtlas() {
  if (root) return;
  buildShell();
  wireEntries();
  if (root) {
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
  }
}

window.openOpeningAtlas = showOpening;
window.closeOpeningAtlas = closeOpening;
window.addEventListener("pageshow", initializeOpeningAtlas);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeOpeningAtlas, { once: true });
else initializeOpeningAtlas();
