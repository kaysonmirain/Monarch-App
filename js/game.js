/* global Chess, EngineStockfish, PieceArt, ChessAI */
(function () {
  const FILES = "abcdefgh";
  /** Match CSS: side-by-side board + dock from this width up; below, dock stacks under the board. */
  const ARENA_SIDE_BY_SIDE_MIN_WIDTH = 1024;

  function pieceSvg(type, color) {
    return PieceArt.svg(type, "piece-svg piece-svg--staunton", { color: color || "w" });
  }

  const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

  /**
   * Stockfish 16 NNUE (single-thread WASM): search stops when depth OR movetime is reached
   * (whichever is satisfied first). We spend more time on *your* turn (best move + outlook) and
   * a shorter search on their turn (mostly outlook refresh) so the UI feels snappy between moves.
   * Single-thread WASM: tuned for snappy first paint and refreshes while keeping coach quality usable.
   * Coach hints update only on final `bestmove`.
   */
  const ENGINE_DEPTH_YOUR_TURN = 40;
  const ENGINE_DEPTH_THEIR_TURN = 26;
  const ENGINE_MOVETIME_MS_YOUR_TURN = 420;
  const ENGINE_MOVETIME_MS_THEIR_TURN = 160;
  /** Fallback JS minimax only when WASM Stockfish is unavailable. */
  const COACH_FALLBACK_AI_DEPTH = 6;

  const chess = new Chess();
  let selected = null;
  let hintSquares = { from: null, to: null };
  let pendingPromotion = null;
  let capturedByWhite = [];
  let capturedByBlack = [];
  let lastMoveSquares = { from: null, to: null, color: null };
  let lastEngineBest = null;
  let sf = null;
  let engineDebounce = null;
  /** One frame so the arena paints before the first Stockfish search (same for White or Black). */
  let enginePaintRaf1 = null;
  /** Bumps when a new engine search starts — ignore stale callbacks from an older search. */
  let engineAnalyzeSeq = 0;
  let userColor = "w";
  let boardFitTimer = null;
  /** Avoid repeating the win toast while the board stays in the same won position. */
  let winToastShown = false;
  let gameToastHideTimer = null;
  let gameToastTransitionTimer = null;

  const boardEl = document.getElementById("board");
  const titleScreen = document.getElementById("titleScreen");
  const arena = document.getElementById("arena");
  const btnPlay = document.getElementById("btnPlay");
  const btnBackMenu = document.getElementById("btnBackMenu");
  const statusText = document.getElementById("statusText");
  const statusPill = document.getElementById("statusPill");
  const btnNew = document.getElementById("btnNew");
  const btnUndo = document.getElementById("btnUndo");
  const btnUndoAll = document.getElementById("btnUndoAll");
  const capYouEl = document.getElementById("capYou");
  const capOppEl = document.getElementById("capOpp");
  const promoModal = document.getElementById("promoModal");
  const promoChoices = document.getElementById("promoChoices");
  const promoCancel = document.getElementById("promoCancel");
  const engineStatusEl = document.getElementById("engineStatus");
  const btnCoachMove = document.getElementById("btnCoachMove");
  const dockWinPct = document.getElementById("dockWinPct");
  const dockDrawPct = document.getElementById("dockDrawPct");
  const dockTheirPct = document.getElementById("dockTheirPct");
  const dockChancesPanel = document.getElementById("dockChancesPanel");
  const gameToastEl = document.getElementById("gameToast");

  let outlookPulseClearTimer = null;

  function clearOutlookPulseSoon(panel) {
    if (!panel) return;
    if (outlookPulseClearTimer != null) {
      window.clearTimeout(outlookPulseClearTimer);
      outlookPulseClearTimer = null;
    }
    outlookPulseClearTimer = window.setTimeout(function () {
      outlookPulseClearTimer = null;
      panel.classList.remove("dock-outlook--pulse");
    }, 1150);
  }

  /** Immersive shimmer / pulse after the split updates (respects reduced motion). */
  function triggerOutlookPulse() {
    var panel = dockChancesPanel;
    if (!panel || panel.classList.contains("dock-chances--idle-stats")) {
      return;
    }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    panel.classList.remove("dock-outlook--pulse");
    window.requestAnimationFrame(function () {
      panel.classList.add("dock-outlook--pulse");
      clearOutlookPulseSoon(panel);
    });
  }

  const squares = [];

  /** Replay CSS entrance animation when dock copy updates (reflow trick). */
  function triggerUiAppear(el) {
    if (!el || !el.classList) return;
    el.classList.remove("ui-enter");
    void el.offsetWidth;
    el.classList.add("ui-enter");
  }

  function setEngineStatusMessage(msg) {
    if (!engineStatusEl) return;
    var s = msg || "";
    engineStatusEl.textContent = s;
    if (s) {
      triggerUiAppear(engineStatusEl);
    } else {
      engineStatusEl.classList.remove("ui-enter");
    }
  }

  function removeCoachDirectionSvgs() {
    if (!boardEl) {
      return;
    }
    boardEl.querySelectorAll(".coach-direction-svg").forEach(function (el) {
      el.remove();
    });
  }

  function opponentColor() {
    return userColor === "w" ? "b" : "w";
  }

  function sideWord(c) {
    return c === "w" ? "White" : "Black";
  }

  /** Same status copy for both sides; only sideWord slots swap when you play White vs Black. */
  function phraseYourTurnStatus() {
    return (
      "Your turn — " +
      sideWord(userColor) +
      " — best-move hints are for you"
    );
  }

  function phraseTheirTurnStatus() {
    return (
      "Their turn — " +
      sideWord(opponentColor()) +
      " — tap their pieces on the board; green hint arrows and the button return on your " +
      sideWord(userColor) +
      " turn"
    );
  }

  function phraseTheirTurnCoach() {
    return (
      sideWord(opponentColor()) +
      " is moving — Monarch only suggests moves for your color (" +
      sideWord(userColor) +
      ") on your turn."
    );
  }

  /** Prefer multipv 1 row; fall back to sorted analysis lines if `rows[1]` was not keyed yet. */
  function primaryEngineRow(payload) {
    if (!payload) return null;
    if (payload.rows && payload.rows[1]) return payload.rows[1];
    if (payload.sorted && payload.sorted.length) {
      var i;
      for (i = 0; i < payload.sorted.length; i++) {
        if (payload.sorted[i].multipv === 1) return payload.sorted[i];
      }
      return payload.sorted[0];
    }
    return null;
  }

  /** Best move / plan from the human’s chosen side only (never highlights opponent-only moves on board). */
  function computeUserPlan(payload) {
    if (!sf || !payload) return null;
    const row1 = primaryEngineRow(payload);
    if (!row1 || !row1.pv || !row1.pv.length) return null;
    const fen = payload.fen;
    const stm = sf.stmFromFen(fen);
    if (stm === userColor) {
      const u = row1.pv[0];
      if (!u || u.length < 4) return null;
      const san = sf.firstUciToSan(fen, row1.pv);
      const dest = u.slice(2, 4);
      return {
        from: u.slice(0, 2),
        to: dest,
        san: san,
        explainUci: u,
        lineText: san + " · " + u.slice(0, 2) + "→" + dest + ".",
      };
    }
    return null;
  }

  /** Plain-language “why” for the coach card (heuristics + outlook). */
  function buildPlanWhy(fen, plan, row1) {
    if (!plan || !plan.explainUci) return "";
    const u = plan.explainUci;
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promo = u.length > 4 ? u[4] : undefined;
    const c = new Chess(fen);
    const m = c.move({ from: from, to: to, promotion: promo });
    if (!m) return "Engine pick for " + sideWord(userColor) + ".";
    return moveWhySentences(m);
  }

  /** Short factual note about why this move type matters (shown under SAN). */
  function moveWhySentences(m) {
    const san = m.san || "";
    if (san.indexOf("#") >= 0) return "Checkmate.";
    if (san.indexOf("+") >= 0) return "Check.";
    if (san.indexOf("O-O-O") === 0) return "Queenside castle.";
    if (san.indexOf("O-O") === 0) return "Kingside castle.";
    if (m.promotion) return "Pawn promotes.";
    if (m.captured) {
      const victim = PIECE_NAMES[m.captured] || m.captured;
      return "Takes " + victim + " on " + m.to + ".";
    }
    if (m.piece === "p") return "Pawn move.";
    if (m.piece === "n") return "Knight jump.";
    if (m.piece === "b") return "Bishop move.";
    if (m.piece === "r") return "Rook move.";
    if (m.piece === "q") return "Queen move.";
    if (m.piece === "k") return "King move.";
    return "Strong try here.";
  }

  function refreshStatusMood() {
    statusPill.classList.remove("status-pill--win", "status-pill--loss", "status-pill--draw");
    if (chess.in_checkmate()) {
      statusPill.classList.add(chess.turn() === userColor ? "status-pill--loss" : "status-pill--win");
    } else if (chess.in_draw() || chess.in_stalemate() || chess.insufficient_material()) {
      statusPill.classList.add("status-pill--draw");
    }
  }

  function setCoachThinkingHint(text) {
    var el = document.getElementById("coachThinkingHint");
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function updateCoachPanel() {
    const coachWhy = document.getElementById("coachWhy");
    if (!coachWhy || !document.body.classList.contains("is-playing")) {
      setCoachThinkingHint("");
      updateCoachMoveButton();
      return;
    }
    if (chess.game_over()) {
      setCoachThinkingHint("");
      if (chess.in_checkmate()) {
        coachWhy.textContent =
          chess.turn() === userColor ? "Checkmate — you lost." : "Checkmate — you won.";
      } else {
        coachWhy.textContent = "Draw.";
      }
      triggerUiAppear(coachWhy);
      updateCoachMoveButton();
      return;
    }
    if (chess.turn() !== userColor) {
      setCoachThinkingHint("");
      coachWhy.textContent = phraseTheirTurnCoach();
      triggerUiAppear(coachWhy);
      updateCoachMoveButton();
      return;
    }
    if (!lastEngineBest) {
      coachWhy.textContent = "";
      coachWhy.classList.remove("ui-enter");
      setCoachThinkingHint("Monarch is thinking…");
      updateCoachMoveButton();
      return;
    }
    const san = lastEngineBest.san || "—";
    const why = lastEngineBest.why || lastEngineBest.lineText || "";
    coachWhy.textContent = "";
    const kicker = document.createElement("span");
    kicker.className = "coach-card__kicker";
    kicker.textContent = "Your move — " + sideWord(userColor);
    coachWhy.appendChild(kicker);
    const moveSpan = document.createElement("span");
    moveSpan.className = "coach-card__move-san";
    moveSpan.textContent = san;
    coachWhy.appendChild(moveSpan);
    if (lastEngineBest.from || lastEngineBest.to) {
      const squarePair = document.createElement("span");
      squarePair.className = "coach-card__square-pair";
      squarePair.setAttribute("aria-label", "From and to squares");
      if (lastEngineBest.from) {
        const fromEl = document.createElement("span");
        fromEl.className = "coach-card__from-square";
        fromEl.textContent = lastEngineBest.from;
        fromEl.setAttribute("aria-label", "From " + lastEngineBest.from);
        squarePair.appendChild(fromEl);
      }
      if (lastEngineBest.to) {
        const destEl = document.createElement("span");
        destEl.className = "coach-card__target-square";
        destEl.textContent = lastEngineBest.to;
        destEl.setAttribute("aria-label", "To " + lastEngineBest.to);
        squarePair.appendChild(destEl);
      }
      coachWhy.appendChild(squarePair);
    }
    if (why) {
      const explain = document.createElement("p");
      explain.className = "coach-card__explain";
      explain.textContent = why;
      coachWhy.appendChild(explain);
    }
    setCoachThinkingHint("");
    triggerUiAppear(coachWhy);
    updateCoachMoveButton();
  }

  function updateCoachMoveButton() {
    if (!btnCoachMove) return;
    let on =
      document.body.classList.contains("is-playing") &&
      !chess.game_over() &&
      chess.turn() === userColor &&
      lastEngineBest &&
      lastEngineBest.explainUci &&
      lastEngineBest.explainUci.length >= 4;
    if (promoModal && !promoModal.classList.contains("hidden")) on = false;
    btnCoachMove.disabled = !on;
  }

  /** One-tap apply engine best move (your turn), like “Move” on next-move trainers. */
  function applyCoachMove() {
    if (!lastEngineBest || !lastEngineBest.explainUci || lastEngineBest.explainUci.length < 4) return;
    if (!document.body.classList.contains("is-playing") || chess.game_over()) return;
    if (chess.turn() !== userColor) return;
    var u = lastEngineBest.explainUci;
    var from = u.slice(0, 2);
    var to = u.slice(2, 4);
    var promo = u.length > 4 ? u[4] : undefined;
    selected = null;
    hintSquares = { from: null, to: null };
    removeCoachDirectionSvgs();
    drawHighlights();
    if (promo) {
      tryMove(from, to, promo);
      return;
    }
    if (maybePromote(from, to)) {
      openPromotion(from, to);
      return;
    }
    tryMove(from, to);
  }

  function clampPctNum(n) {
    if (n == null || Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  /** Round three shares to whole percents that sum to 100 (largest remainder — keeps “them” fair vs always boosting the biggest bucket). */
  function pctTripleRounded(you, draw, them) {
    var y = clampPctNum(you);
    var d = clampPctNum(draw);
    var t = clampPctNum(them);
    var sum = y + d + t;
    if (sum <= 0) {
      return { you: 33, draw: 34, them: 33 };
    }
    var ny = (y / sum) * 100;
    var nd = (d / sum) * 100;
    var nt = (t / sum) * 100;
    var yi = Math.floor(ny + 1e-9);
    var di = Math.floor(nd + 1e-9);
    var ti = Math.floor(nt + 1e-9);
    var rem = 100 - yi - di - ti;
    var pool = [
      { key: "you", frac: ny - yi },
      { key: "draw", frac: nd - di },
      { key: "them", frac: nt - ti },
    ];
    pool.sort(function (a, b) {
      return b.frac - a.frac;
    });
    var i;
    for (i = 0; i < rem; i++) {
      if (pool[i].key === "you") {
        yi++;
      } else if (pool[i].key === "draw") {
        di++;
      } else {
        ti++;
      }
    }
    return { you: yi, draw: di, them: ti };
  }

  function normalizeUserOutlook(raw, uc) {
    var sum = raw.whiteWin + raw.draw + raw.blackWin;
    if (sum <= 0) return null;
    var w = (raw.whiteWin / sum) * 100;
    var dr = (raw.draw / sum) * 100;
    var b = (raw.blackWin / sum) * 100;
    if (uc === "w") {
      return { you: w, draw: dr, them: b };
    }
    return { you: b, draw: dr, them: w };
  }

  /** Outlook boxes stay equal width in CSS; strip legacy --dock-out-* vars when idle. */
  function setDockOutlookMeterFlex(you, draw, them, idle) {
    var panel = dockChancesPanel;
    if (!panel) return;
    if (idle) {
      panel.style.removeProperty("--dock-out-you");
      panel.style.removeProperty("--dock-out-draw");
      panel.style.removeProperty("--dock-out-them");
      return;
    }
  }

  function dockChanceHeadingElements() {
    if (!dockChancesPanel) return { youHead: null, themHead: null, youCol: null, themCol: null };
    return {
      youHead: dockChancesPanel.querySelector(".dock-chances__col--you .dock-chances__col-head"),
      themHead: dockChancesPanel.querySelector(".dock-chances__col--them .dock-chances__col-head"),
      youCol: dockChancesPanel.querySelector(".dock-chances__col--you"),
      themCol: dockChancesPanel.querySelector(".dock-chances__col--them"),
    };
  }

  function setDockOutlookColumnHeadings(triple, opts) {
    opts = opts || {};
    var h = dockChanceHeadingElements();
    if (!h.youHead || !h.themHead) return;
    if (!triple || opts.idle) {
      h.youHead.textContent = "You win";
      h.themHead.textContent = "They win";
      if (h.youCol) h.youCol.setAttribute("aria-label", "You win");
      if (h.themCol) h.themCol.setAttribute("aria-label", "They win");
      return;
    }
    if (userColor === "w") {
      h.youHead.textContent = "You win · White";
      h.themHead.textContent = "They win · Black";
      if (h.youCol) h.youCol.setAttribute("aria-label", "Your win chance playing White");
      if (h.themCol) h.themCol.setAttribute("aria-label", "Their win chance playing Black");
    } else {
      h.youHead.textContent = "You win · Black";
      h.themHead.textContent = "They win · White";
      if (h.youCol) h.youCol.setAttribute("aria-label", "Your win chance playing Black");
      if (h.themCol) h.themCol.setAttribute("aria-label", "Their win chance playing White");
    }
  }

  function setDockChancePercents(triple) {
    if (!dockWinPct || !dockDrawPct || !dockTheirPct) return;
    if (!triple) {
      dockWinPct.textContent = "—";
      dockDrawPct.textContent = "—";
      dockTheirPct.textContent = "—";
      setDockOutlookMeterFlex(0, 0, 0, true);
      setDockOutlookColumnHeadings(null, { idle: true });
      var dockPanelIdle = dockChancesPanel;
      if (dockPanelIdle) {
        dockPanelIdle.classList.remove("dock-outlook--pulse");
        dockPanelIdle.classList.add("dock-chances--idle-stats");
        dockPanelIdle.setAttribute("aria-label", "Rough win, draw, and loss outlook — not loaded yet.");
      }
      return;
    }
    dockWinPct.textContent = String(triple.you);
    dockDrawPct.textContent = String(triple.draw);
    dockTheirPct.textContent = String(triple.them);
    setDockOutlookColumnHeadings(triple);
    var dockPanelLive = dockChancesPanel;
    var youSideWord = userColor === "w" ? "White" : "Black";
    var oppSideWord = userColor === "w" ? "Black" : "White";
    if (dockPanelLive) {
      dockPanelLive.classList.remove("dock-chances--idle-stats");
      dockPanelLive.setAttribute(
        "aria-label",
        "Rough outlook from the position: about " +
          triple.you +
          " percent chance " +
          youSideWord +
          " wins, " +
          triple.draw +
          " percent draw, " +
          triple.them +
          " percent " +
          oppSideWord +
          " wins."
      );
    }
    setDockOutlookMeterFlex(triple.you, triple.draw, triple.them, false);
    triggerOutlookPulse();
  }

  function resetDockWinOddsPlaceholder() {
    setDockChancePercents(null);
  }

  function refreshDockWinOddsTerminal() {
    if (!document.body.classList.contains("is-playing") || !dockWinPct) return;
    if (!chess.game_over()) {
      return;
    }
    if (chess.in_checkmate()) {
      var youWon = chess.turn() !== userColor;
      setDockChancePercents(youWon ? { you: 100, draw: 0, them: 0 } : { you: 0, draw: 0, them: 100 });
      return;
    }
    setDockChancePercents({ you: 33, draw: 34, them: 33 });
  }

  function updateDockWinOddsFromPayload(payload, opts) {
    opts = opts || {};
    if (!document.body.classList.contains("is-playing")) return;
    if (chess.game_over()) {
      refreshDockWinOddsTerminal();
      return;
    }
    if (!sf || !payload || payload.fen !== chess.fen()) return;
    if (opts.engineMissing) {
      setDockChancePercents(null);
      return;
    }
    var row1 = primaryEngineRow(payload);
    if (!row1) return;
    var raw = sf.outlookForUi(payload.fen, row1);
    if (!raw) return;
    var n = normalizeUserOutlook(raw, userColor);
    if (!n) return;
    var triple = pctTripleRounded(n.you, n.draw, n.them);
    setDockChancePercents(triple);
  }

  function syncCoachFromEngine(payload) {
    if (!sf || !payload || !payload.fen) return;
    if (payload.fen !== chess.fen()) return;
    const stm = sf.stmFromFen(payload.fen);
    if (stm !== userColor) {
      lastEngineBest = null;
      hintSquares = { from: null, to: null };
      removeCoachDirectionSvgs();
      return;
    }
    const fen = payload.fen;
    const row1 = primaryEngineRow(payload);

    /** Final move only: prefer engine `bestmove` so PV multipv quirks never flash wrong squares. */
    if (payload.done && payload.bestmove && payload.bestmove.length >= 4) {
      const u = payload.bestmove;
      const from = u.slice(0, 2);
      const to = u.slice(2, 4);
      const promo = u.length > 4 ? u[4] : undefined;
      try {
        const c = new Chess(fen);
        const m = c.move({ from: from, to: to, promotion: promo });
        if (m && m.color === userColor) {
          lastEngineBest = {
            from: from,
            to: to,
            san: m.san || "—",
            explainUci: u,
            lineText: (m.san || "—") + " · " + from + "→" + to + ".",
            why: row1 ? buildPlanWhy(fen, { explainUci: u }, row1) : moveWhySentences(m),
          };
          hintSquares = { from: from, to: to };
          reconcileCoachDirections();
          return;
        }
      } catch (e) {
        /* fall through */
      }
    }

    const plan = computeUserPlan(payload);
    if (plan && row1) {
      plan.why = buildPlanWhy(payload.fen, plan, row1);
      lastEngineBest = plan;
      if (plan.from && plan.to) {
        hintSquares = { from: plan.from, to: plan.to };
      }
    } else if (payload.done) {
      lastEngineBest = null;
      hintSquares = { from: null, to: null };
    }
    reconcileCoachDirections();
  }

  function syncDockHeightToBoardFrame() {
    if (!document.body.classList.contains("is-playing")) {
      document.documentElement.style.removeProperty("--dock-height");
      return;
    }
    if (typeof window.innerWidth === "number" && window.innerWidth < ARENA_SIDE_BY_SIDE_MIN_WIDTH) {
      document.documentElement.style.removeProperty("--dock-height");
      return;
    }
    if (!boardEl) return;
    var frame = boardEl.closest(".board-frame--fullscreen");
    if (!frame) return;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        if (!document.body.classList.contains("is-playing") || window.innerWidth < ARENA_SIDE_BY_SIDE_MIN_WIDTH) return;
        var h = frame.getBoundingClientRect().height;
        if (h > 0) {
          document.documentElement.style.setProperty("--dock-height", Math.round(h) + "px");
        }
      });
    });
  }

  function fitBoard() {
    if (!document.body.classList.contains("is-playing")) return;
    const topHud = 52;
    const pad = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const reserveSides = vw >= ARENA_SIDE_BY_SIDE_MIN_WIDTH ? Math.min(324, vw * 0.36) : 0;
    const usableW = Math.max(200, vw - pad * 2 - reserveSides);
    /* Board sizing: narrow/stacked layout keeps the dock under the board in scroll — never reserve fake "dock" height. */
    const usableH = Math.max(200, vh - topHud - pad);
    const raw = Math.min(usableW, usableH, 760);
    const size = Math.round(Math.max(268, raw));
    document.documentElement.style.setProperty("--board-size", size + "px");
    syncDockHeightToBoardFrame();
  }

  function sqName(row, col) {
    return FILES[col] + (8 - row);
  }

  function parseSq(name) {
    if (!name || name.length < 2) return null;
    const file = FILES.indexOf(name[0]);
    const rankNum = parseInt(name[1], 10);
    if (file < 0 || file > 7 || rankNum < 1 || rankNum > 8 || Number.isNaN(rankNum)) return null;
    return { row: 8 - rankNum, col: file };
  }

  /** Corner square for a knight jump (orthogonal L), or null if not a knight move. */
  function knightMidSquareName(fromSq, toSq) {
    var a = parseSq(fromSq);
    var b = parseSq(toSq);
    if (!a || !b) return null;
    var dCol = b.col - a.col;
    var dRow = b.row - a.row;
    var ac = Math.abs(dCol);
    var ar = Math.abs(dRow);
    if (!((ac === 1 && ar === 2) || (ac === 2 && ar === 1))) {
      return null;
    }
    var ir;
    var ic;
    if (ac === 2) {
      ic = a.col + (dCol > 0 ? 2 : -2);
      ir = a.row;
    } else {
      ic = a.col;
      ir = a.row + (dRow > 0 ? 2 : -2);
    }
    if (ic < 0 || ic > 7 || ir < 0 || ir > 7) {
      return null;
    }
    return sqName(ir, ic);
  }

  function squareGeomInBoard(sq) {
    var el = squareEl(sq);
    if (!el || !boardEl) return null;
    var x = 0;
    var y = 0;
    var node = el;
    while (node && node !== boardEl) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    if (node === boardEl) {
      return {
        cx: x + el.offsetWidth / 2,
        cy: y + el.offsetHeight / 2,
        sqw: el.offsetWidth,
      };
    }
    /* Safari / some grids: square.offsetParent isn't #board — use padding-box coords vs viewport. */
    var rect = boardEl.getBoundingClientRect();
    var st = window.getComputedStyle(boardEl);
    var bl = parseFloat(st.borderLeftWidth) || 0;
    var bt = parseFloat(st.borderTopWidth) || 0;
    var ox = rect.left + bl;
    var oy = rect.top + bt;
    var r = el.getBoundingClientRect();
    return {
      cx: r.left + r.width / 2 - ox,
      cy: r.top + r.height / 2 - oy,
      sqw: r.width,
    };
  }

  function squareCenterPx(sq) {
    var G = squareGeomInBoard(sq);
    if (!G) return null;
    return { x: G.cx, y: G.cy, sqw: G.sqw };
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    squares.length = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = document.createElement("div");
        const name = sqName(row, col);
        sq.className = "square " + ((row + col) % 2 === 0 ? "light" : "dark");
        sq.dataset.square = name;
        sq.setAttribute("role", "button");
        sq.setAttribute("aria-label", "Square " + name);
        if (col === 0) {
          const rankEl = document.createElement("span");
          rankEl.className = "coord rank";
          rankEl.textContent = String(8 - row);
          sq.appendChild(rankEl);
        }
        if (row === 7) {
          const fileEl = document.createElement("span");
          fileEl.className = "coord file";
          fileEl.textContent = FILES[col];
          sq.appendChild(fileEl);
        }
        sq.addEventListener("click", onSquareClick);
        boardEl.appendChild(sq);
        squares.push(sq);
      }
    }
  }

  function squareEl(name) {
    const p = parseSq(name);
    if (!p) return null;
    return squares[p.row * 8 + p.col];
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function castleRookMove(move) {
    if (!move.flags) return null;
    if (move.flags.indexOf("k") !== -1) {
      return move.color === "w" ? { from: "h1", to: "f1" } : { from: "h8", to: "f8" };
    }
    if (move.flags.indexOf("q") !== -1) {
      return move.color === "w" ? { from: "a1", to: "d1" } : { from: "a8", to: "d8" };
    }
    return null;
  }

  function epVictimSquare(move) {
    if (!move.flags || move.flags.indexOf("e") === -1) return null;
    const f = move.to[0];
    const tr = parseInt(move.to[1], 10);
    const capRank = move.color === "w" ? tr - 1 : tr + 1;
    return f + capRank;
  }

  function flagFadeVictims(move) {
    const ep = epVictimSquare(move);
    if (ep) {
      const el = squareEl(ep);
      if (el) {
        const p = el.querySelector(".piece");
        if (p) p.classList.add("piece--fade-capture");
      }
      return;
    }
    if (move.captured) {
      const el = squareEl(move.to);
      if (el) {
        const p = el.querySelector(".piece");
        if (p) p.classList.add("piece--fade-capture");
      }
    }
  }

  function resetTransientPieceStyles() {
    squares.forEach(function (sq) {
      const p = sq.querySelector(".piece");
      if (p) {
        p.classList.remove("piece--fade-capture");
        p.style.opacity = "";
      }
    });
  }

  function spawnGhost(from, to, done) {
    const fromSq = squareEl(from);
    const toSq = squareEl(to);
    const pieceEl = fromSq && fromSq.querySelector(".piece");
    if (!fromSq || !toSq || !pieceEl) {
      done();
      return;
    }
    const fr = fromSq.getBoundingClientRect();
    const tr = toSq.getBoundingClientRect();
    const dx = tr.left - fr.left;
    const dy = tr.top - fr.top;
    const wrap = document.createElement("div");
    wrap.className = "piece-move-float";
    wrap.style.position = "fixed";
    wrap.style.left = fr.left + "px";
    wrap.style.top = fr.top + "px";
    wrap.style.width = fr.width + "px";
    wrap.style.height = fr.height + "px";
    wrap.style.margin = "0";
    wrap.style.zIndex = "200";
    wrap.style.pointerEvents = "none";
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.boxSizing = "border-box";
    wrap.style.willChange = "transform";
    wrap.style.transform = "translate(0px, 0px) scale(1)";
    const ghost = pieceEl.cloneNode(true);
    ghost.classList.add("piece--ghost");
    ghost.style.removeProperty("transform");
    wrap.appendChild(ghost);
    document.body.appendChild(wrap);
    pieceEl.style.opacity = "0";
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        wrap.classList.add("piece-move-float--travel");
        wrap.style.transform = "translate(" + dx + "px," + dy + "px) scale(1)";
      });
    });
    let doneOnce = false;
    function finish() {
      if (doneOnce) return;
      doneOnce = true;
      wrap.remove();
      done();
    }
    wrap.addEventListener(
      "transitionend",
      function (e) {
        if (e.propertyName === "transform") finish();
      },
      false
    );
    window.setTimeout(finish, 620);
  }

  function pulseLandingSquare(sqName) {
    if (!sqName || prefersReducedMotion()) return;
    var el = squareEl(sqName);
    if (!el) return;
    el.classList.add("square-move-land");
    window.setTimeout(function () {
      el.classList.remove("square-move-land");
    }, 400);
  }

  function runMoveAnimations(move, cb) {
    if (prefersReducedMotion()) {
      cb();
      return;
    }
    const tasks = [{ from: move.from, to: move.to }];
    const cr = castleRookMove(move);
    if (cr) tasks.push(cr);
    flagFadeVictims(move);
    let pending = tasks.length;
    if (pending === 0) {
      cb();
      return;
    }
    tasks.forEach(function (t) {
      spawnGhost(t.from, t.to, function () {
        pending--;
        if (pending <= 0) {
          /* Do not reset inline piece styles here — clearing opacity before fullRedraw()
             briefly showed the from-square piece again (jump). Reset runs after redraw. */
          cb();
        }
      });
    });
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  /** Last-move square tint only after you moved your color — not when you tapped for the opponent. */
  function lastMoveFeedbackForUser() {
    return (
      lastMoveSquares.from &&
      lastMoveSquares.to &&
      lastMoveSquares.color === userColor
    );
  }

  /** Arrow from square center → square center, trimmed so the head aims into the destination (not past it). */
  function segmentBetweenSquareCenters(fromSq, toSq) {
    var G1 = squareGeomInBoard(fromSq);
    var G2 = squareGeomInBoard(toSq);
    if (!G1 || !G2) return null;
    var bw = boardEl.clientWidth;
    var bh = boardEl.clientHeight;
    if (bw < 4 || bh < 4) return null;
    var x1 = G1.cx;
    var y1 = G1.cy;
    var x2 = G2.cx;
    var y2 = G2.cy;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 4) return null;
    var ux = dx / len;
    var uy = dy / len;
    var sq = Math.min(G1.sqw, G2.sqw);
    var pullFrom = Math.min(len * 0.065, sq * 0.15, 20);
    var pullTo = Math.min(len * 0.175, sq * 0.4, 52);
    x1 += ux * pullFrom;
    y1 += uy * pullFrom;
    x2 -= ux * pullTo;
    y2 -= uy * pullTo;
    var segLen = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    if (segLen < 2) return null;
    return { x1: x1, y1: y1, x2: x2, y2: y2, bw: bw, bh: bh, segLen: segLen, sq: sq };
  }

  function vecNorm(x, y) {
    var L = Math.sqrt(x * x + y * y) || 1;
    return [x / L, y / L];
  }

  function vecPerp(x, y) {
    return [-y, x];
  }

  /** Intersection of ray p1 + t*d1 and ray p2 + s*d2. */
  function rayRayIntersection(p1, d1, p2, d2) {
    var cross = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cross) < 1e-9) return null;
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];
    var s = (dx * d2[1] - dy * d2[0]) / cross;
    return [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
  }

  /** Single filled polygon: shaft + tip (no line/marker seam). */
  function straightArrowShapePath(x1, y1, x2, y2, sq) {
    var hw = Math.max(2.75, Math.min(sq * 0.082, 4.35));
    /* Narrower head base than shaft so the ribbon does not read as a thick shaft inside the triangle. */
    var hh = Math.max(1.65, hw * 0.44);
    var headLen = Math.max(12, Math.min(sq * 0.37, 28));
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len;
    var uy = dy / len;
    var nx = -uy;
    var ny = ux;
    var tipx = x2 + ux * headLen;
    var tipy = y2 + uy * headLen;
    var tl = [x1 + nx * hw, y1 + ny * hw];
    var tr = [x1 - nx * hw, y1 - ny * hw];
    var nl = [x2 + nx * hh, y2 + ny * hh];
    var nr = [x2 - nx * hh, y2 - ny * hh];
    function r(v) {
      return v[0].toFixed(2) + " " + v[1].toFixed(2);
    }
    return "M " + r(tl) + " L " + r(nl) + " L " + tipx.toFixed(2) + " " + tipy.toFixed(2) + " L " + r(nr) + " L " + r(tr) + " Z";
  }

  /** Knight path as one ribbon + tip with miters at the bend. */
  function knightArrowShapePath(ax, ay, mx, my, cx, cy, sq) {
    var hw = Math.max(2.75, Math.min(sq * 0.082, 4.35));
    var hh = Math.max(1.65, hw * 0.44);
    var headLen = Math.max(12, Math.min(sq * 0.37, 28));
    var u0 = vecNorm(mx - ax, my - ay);
    var u1 = vecNorm(cx - mx, cy - my);
    var n0 = vecPerp(u0[0], u0[1]);
    var n1 = vecPerp(u1[0], u1[1]);
    var turn = u0[0] * u1[1] - u0[1] * u1[0];
    var outerSign = turn >= 0 ? -1 : 1;
    var innerSign = -outerSign;
    var OA = [ax + n0[0] * hw * outerSign, ay + n0[1] * hw * outerSign];
    var IA = [ax + n0[0] * hw * innerSign, ay + n0[1] * hw * innerSign];
    var OC = [cx + n1[0] * hh * outerSign, cy + n1[1] * hh * outerSign];
    var IC = [cx + n1[0] * hh * innerSign, cy + n1[1] * hh * innerSign];
    var OM = rayRayIntersection(OA, u0, OC, [-u1[0], -u1[1]]);
    var IM = rayRayIntersection(IA, u0, IC, [-u1[0], -u1[1]]);
    if (!OM || !IM) {
      return straightArrowShapePath(ax, ay, cx, cy, sq);
    }
    var tipx = cx + u1[0] * headLen;
    var tipy = cy + u1[1] * headLen;
    function f(v) {
      return v[0].toFixed(2) + " " + v[1].toFixed(2);
    }
    return (
      "M " +
      f(OA) +
      " L " +
      f(OM) +
      " L " +
      f(OC) +
      " L " +
      tipx.toFixed(2) +
      " " +
      tipy.toFixed(2) +
      " L " +
      f(IC) +
      " L " +
      f(IM) +
      " L " +
      f(IA) +
      " Z"
    );
  }

  function appendStraightDirectionArrow(svgClass, fromSq, toSq, shapeClass) {
    var seg = segmentBetweenSquareCenters(fromSq, toSq);
    if (!seg) return;
    var x1 = seg.x1;
    var y1 = seg.y1;
    var x2 = seg.x2;
    var y2 = seg.y2;
    var bw = seg.bw;
    var bh = seg.bh;

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", svgClass);
    svg.setAttribute("data-arrow-from", fromSq);
    svg.setAttribute("data-arrow-to", toSq);
    svg.setAttribute("viewBox", "0 0 " + bw + " " + bh);
    svg.setAttribute("aria-hidden", "true");

    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", straightArrowShapePath(x1, y1, x2, y2, seg.sq));
    path.setAttribute("class", shapeClass);
    svg.appendChild(path);
    boardEl.appendChild(svg);
  }

  function appendKnightDirectionArrow(svgClass, fromSq, midSq, toSq, shapeClass) {
    var bw = boardEl.clientWidth;
    var bh = boardEl.clientHeight;
    if (bw < 4 || bh < 4) return;
    var P0 = squareCenterPx(fromSq);
    var Pm = squareCenterPx(midSq);
    var P1 = squareCenterPx(toSq);
    if (!P0 || !Pm || !P1) return;
    var sq = Math.min(P0.sqw, Pm.sqw, P1.sqw);

    var dx0 = Pm.x - P0.x;
    var dy0 = Pm.y - P0.y;
    var len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
    var u0x = dx0 / len0;
    var u0y = dy0 / len0;
    var dx1 = P1.x - Pm.x;
    var dy1 = P1.y - Pm.y;
    var len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    var u1x = dx1 / len1;
    var u1y = dy1 / len1;

    var pull0 = Math.min(len0 * 0.07, sq * 0.14, 18);
    var pull1 = Math.min(len1 * 0.175, sq * 0.4, 52);
    var ax = P0.x + u0x * pull0;
    var ay = P0.y + u0y * pull0;
    var cx = P1.x - u1x * pull1;
    var cy = P1.y - u1y * pull1;

    var leg0 = Math.sqrt((Pm.x - ax) * (Pm.x - ax) + (Pm.y - ay) * (Pm.y - ay));
    var leg1 = Math.sqrt((cx - Pm.x) * (cx - Pm.x) + (cy - Pm.y) * (cy - Pm.y));
    if (leg0 + leg1 < 2) return;

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", svgClass);
    svg.setAttribute("data-arrow-from", fromSq);
    svg.setAttribute("data-arrow-to", toSq);
    svg.setAttribute("viewBox", "0 0 " + bw + " " + bh);
    svg.setAttribute("aria-hidden", "true");

    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", knightArrowShapePath(ax, ay, Pm.x, Pm.y, cx, cy, sq));
    path.setAttribute("class", shapeClass);
    svg.appendChild(path);
    boardEl.appendChild(svg);
  }

  function appendDirectionArrow(svgClass, fromSq, toSq, shapeClass) {
    var midSq = knightMidSquareName(fromSq, toSq);
    if (midSq) {
      appendKnightDirectionArrow(svgClass, fromSq, midSq, toSq, shapeClass);
    } else {
      appendStraightDirectionArrow(svgClass, fromSq, toSq, shapeClass);
    }
  }

  /**
   * Coach hints only on your clock, and only if the segment is legal for your piece.
   * Highlights both the piece to move (amber) and the destination square (teal).
   * Clears stale engine UI when switching sides or when PV no longer fits the board.
   */
  function reconcileCoachDirections() {
    if (!document.body.classList.contains("is-playing")) {
      hintSquares = { from: null, to: null };
      lastEngineBest = null;
      removeCoachDirectionSvgs();
      return;
    }
    if (chess.game_over()) {
      hintSquares = { from: null, to: null };
      lastEngineBest = null;
      removeCoachDirectionSvgs();
      return;
    }
    if (chess.turn() !== userColor) {
      hintSquares = { from: null, to: null };
      lastEngineBest = null;
      removeCoachDirectionSvgs();
      return;
    }
    if (!hintSquares.from || !hintSquares.to) {
      removeCoachDirectionSvgs();
      return;
    }
    var fromParsed = parseSq(hintSquares.from);
    if (!fromParsed) {
      hintSquares = { from: null, to: null };
      lastEngineBest = null;
      removeCoachDirectionSvgs();
      return;
    }
    var cell = chess.board()[fromParsed.row][fromParsed.col];
    if (!cell || cell.color !== userColor) {
      hintSquares = { from: null, to: null };
      lastEngineBest = null;
      removeCoachDirectionSvgs();
      return;
    }
    var leg = chess.moves({ square: hintSquares.from, verbose: true });
    var ok = false;
    var t;
    for (t = 0; t < leg.length; t++) {
      if (leg[t].to === hintSquares.to) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      hintSquares = { from: null, to: null };
      lastEngineBest = null;
      removeCoachDirectionSvgs();
    }
  }

  function updateMoveDirectionOverlay() {
    boardEl.querySelectorAll(".move-direction-svg").forEach(function (el) {
      el.remove();
    });
  }

  function updateCoachDirectionOverlay() {
    reconcileCoachDirections();
    removeCoachDirectionSvgs();
  }

  function captureToken(pieceColor, pieceType) {
    return (
      '<span class="cap-piece cap-piece--' + pieceColor + '">' + pieceSvg(pieceType, pieceColor) + "</span>"
    );
  }

  function clearHighlights() {
    squares.forEach(function (el) {
      el.classList.remove(
        "selected",
        "highlight-selected",
        "highlight-legal",
        "highlight-last-from",
        "highlight-last-to",
        "highlight-coach-from",
        "highlight-coach-to",
        "square-move-land"
      );
      const old = el.querySelector(".piece");
      if (old) old.remove();
    });
  }

  function renderPieces() {
    const b = chess.board();
    squares.forEach(function (el, idx) {
      const row = Math.floor(idx / 8);
      const col = idx % 8;
      const cell = b[row][col];
      const existing = el.querySelector(".piece");
      if (existing) existing.remove();
      if (!cell) return;
      const span = document.createElement("span");
      span.className = "piece piece--" + cell.color;
      span.dataset.color = cell.color;
      span.innerHTML = pieceSvg(cell.type, cell.color);
      el.appendChild(span);
    });
  }

  function drawHighlights() {
    squares.forEach(function (el) {
      el.classList.remove(
        "selected",
        "highlight-selected",
        "highlight-legal",
        "highlight-last-from",
        "highlight-last-to",
        "highlight-coach-from",
        "highlight-coach-to",
        "square-move-land"
      );
    });

    reconcileCoachDirections();

    if (lastMoveFeedbackForUser()) {
      const lastFrom = squareEl(lastMoveSquares.from);
      const lastTo = squareEl(lastMoveSquares.to);
      if (lastFrom) lastFrom.classList.add("highlight-last-from");
      if (lastTo) lastTo.classList.add("highlight-last-to");
    }

    if (hintSquares.from && hintSquares.to) {
      const hintFrom = squareEl(hintSquares.from);
      const hintTo = squareEl(hintSquares.to);
      if (hintFrom) hintFrom.classList.add("highlight-coach-from");
      if (hintTo) hintTo.classList.add("highlight-coach-to");
    }

    if (selected) {
      const selEl = squareEl(selected);
      if (!selEl) {
        selected = null;
        return;
      }
      selEl.classList.add("selected", "highlight-selected");
      const moves = chess.moves({ square: selected, verbose: true });
      moves.forEach(function (m) {
        const legEl = squareEl(m.to);
        if (legEl) legEl.classList.add("highlight-legal");
      });
    }
  }

  function fullRedraw() {
    clearHighlights();
    renderPieces();
    drawHighlights();
    updateMoveDirectionOverlay();
    updateCoachDirectionOverlay();
  }

  function recordCapture(move) {
    if (!move.captured) return;
    const capColor = move.color === "w" ? "b" : "w";
    const token = captureToken(capColor, move.captured);
    if (move.color === "w") capturedByWhite.push(token);
    else capturedByBlack.push(token);
  }

  function renderCaptures() {
    if (!capYouEl || !capOppEl) return;
    if (userColor === "w") {
      capYouEl.innerHTML = capturedByWhite.join("");
      capOppEl.innerHTML = capturedByBlack.join("");
    } else {
      capYouEl.innerHTML = capturedByBlack.join("");
      capOppEl.innerHTML = capturedByWhite.join("");
    }
  }

  function cancelEngineSchedule() {
    window.clearTimeout(engineDebounce);
    engineDebounce = null;
    if (enginePaintRaf1 != null) {
      window.cancelAnimationFrame(enginePaintRaf1);
      enginePaintRaf1 = null;
    }
  }

  function scheduleEngineAnalyze() {
    if (!document.body.classList.contains("is-playing")) return;
    cancelEngineSchedule();
    if (!chess.game_over() && chess.turn() === userColor) {
      if (!sf) {
        lastEngineBest = null;
        hintSquares = { from: null, to: null };
        /* Defer JS minimax so the arena can paint first (White was blocking here; Black skipped this branch). */
        engineDebounce = window.setTimeout(function () {
          engineDebounce = null;
          if (!document.body.classList.contains("is-playing") || chess.game_over()) return;
          if (chess.turn() !== userColor) return;
          if (sf) {
            scheduleEngineAnalyze();
            return;
          }
          coachFallbackFromJsAi();
          updateCoachPanel();
          drawHighlights();
          updateCoachDirectionOverlay();
        }, 0);
        return;
      }
      enginePaintRaf1 = window.requestAnimationFrame(function () {
        enginePaintRaf1 = null;
        runEngineAnalyze();
      });
      return;
    }
    if (!sf) return;
    engineDebounce = window.setTimeout(function () {
      engineDebounce = null;
      runEngineAnalyze();
    }, 0);
  }

  /** Coarse suggestion when Stockfish is not loaded (sync only). */
  function coachFallbackFromJsAi() {
    if (!document.body.classList.contains("is-playing") || chess.game_over()) return;
    if (chess.turn() !== userColor) return;
    if (typeof ChessAI === "undefined" || !ChessAI.bestMoveForSide) return;
    var m = ChessAI.bestMoveForSide(chess, COACH_FALLBACK_AI_DEPTH, userColor);
    if (!m || !m.from || !m.to) return;
    var uci = m.from + m.to;
    if (m.promotion) uci += m.promotion;
    lastEngineBest = {
      from: m.from,
      to: m.to,
      san: m.san || "—",
      explainUci: uci,
      lineText: (m.san || "—") + " · " + m.from + "→" + m.to + ".",
      why: moveWhySentences(m),
    };
    hintSquares = { from: m.from, to: m.to };
    reconcileCoachDirections();
  }

  function runEngineAnalyze() {
    if (chess.game_over()) {
      setEngineStatusMessage("");
      refreshDockWinOddsTerminal();
      return;
    }
    if (!sf) {
      updateDockWinOddsFromPayload(null, { engineMissing: true });
      return;
    }
    const fen = chess.fen();
    const yourTurn = chess.turn() === userColor;
    const seq = ++engineAnalyzeSeq;

    if (yourTurn) {
      lastEngineBest = null;
      hintSquares = { from: null, to: null };
      updateCoachPanel();
      drawHighlights();
      updateCoachDirectionOverlay();
    }

    if (engineStatusEl && document.body.classList.contains("is-playing")) {
      setEngineStatusMessage("");
    }

    const depth = yourTurn ? ENGINE_DEPTH_YOUR_TURN : ENGINE_DEPTH_THEIR_TURN;
    const movetime = yourTurn ? ENGINE_MOVETIME_MS_YOUR_TURN : ENGINE_MOVETIME_MS_THEIR_TURN;

    sf.analyze(
      fen,
      { depth: depth, movetime: movetime },
      function (payload) {
        if (!payload) return;
        if (!document.body.classList.contains("is-playing")) return;
        if (seq !== engineAnalyzeSeq) return;
        if (payload.fen !== chess.fen()) return;

        if (!payload.done) {
          updateDockWinOddsFromPayload(payload);
          return;
        }

        syncCoachFromEngine(payload);
        updateDockWinOddsFromPayload(payload);
        updateCoachPanel();
        if (engineStatusEl && chess.turn() === userColor) {
          setEngineStatusMessage("");
        }
        fullRedraw();
      }
    );
  }

  function hideGameToastNow() {
    if (!gameToastEl) return;
    if (gameToastHideTimer) {
      window.clearTimeout(gameToastHideTimer);
      gameToastHideTimer = null;
    }
    if (gameToastTransitionTimer) {
      window.clearTimeout(gameToastTransitionTimer);
      gameToastTransitionTimer = null;
    }
    gameToastEl.classList.remove("win-celebration--visible");
    gameToastTransitionTimer = window.setTimeout(function () {
      gameToastEl.hidden = true;
      gameToastTransitionTimer = null;
    }, 520);
  }

  function showWinToast() {
    if (!gameToastEl || !document.body.classList.contains("is-playing")) return;
    if (gameToastHideTimer) {
      window.clearTimeout(gameToastHideTimer);
      gameToastHideTimer = null;
    }
    if (gameToastTransitionTimer) {
      window.clearTimeout(gameToastTransitionTimer);
      gameToastTransitionTimer = null;
    }
    gameToastEl.className = "win-celebration";
    gameToastEl.hidden = false;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        gameToastEl.classList.add("win-celebration--visible");
      });
    });
    gameToastHideTimer = window.setTimeout(function () {
      hideGameToastNow();
      gameToastHideTimer = null;
    }, 8200);
  }

  function setStatus() {
    if (!chess.game_over()) {
      winToastShown = false;
    }
    refreshStatusMood();
    statusPill.classList.remove("waiting");
    if (chess.in_checkmate()) {
      const mated = chess.turn();
      statusText.textContent =
        mated === userColor
          ? "Checkmate — they won this story. Breathe — spin a new board anytime."
          : "Checkmate — you did it! That’s a real win cup of tea moment.";
      if (mated !== userColor && !winToastShown) {
        winToastShown = true;
        showWinToast();
      }
    } else if (chess.in_draw() || chess.in_stalemate() || chess.insufficient_material()) {
      statusText.textContent = "Draw — nobody lost; call it a cozy stalemate.";
    } else {
      if (chess.in_check()) {
        statusText.textContent =
          chess.turn() === userColor
            ? "You’re in check — your king needs a safe square."
            : "Their turn, and they’re in check — find a legal rescue for them.";
      } else {
        statusText.textContent =
          chess.turn() === userColor ? phraseYourTurnStatus() : phraseTheirTurnStatus();
      }
    }
    setUndoEnabled();
    updateCoachPanel();
    refreshDockWinOddsTerminal();
  }

  function setUndoEnabled() {
    const h = chess.history().length;
    btnUndo.disabled = h === 0;
    if (btnUndoAll) {
      btnUndoAll.disabled = h === 0;
    }
  }

  function updateLastMoveText() {
    const hist = chess.history({ verbose: true });
    if (!hist.length) {
      lastMoveSquares = { from: null, to: null, color: null };
      return;
    }
    const last = hist[hist.length - 1];
    lastMoveSquares = { from: last.from, to: last.to, color: last.color };
  }

  function tryMove(from, to, promotion) {
    const opts = { from: from, to: to };
    if (promotion) opts.promotion = promotion;
    const probe = new Chess(chess.fen());
    const move = probe.move(opts);
    if (!move) return false;
    selected = null;
    hintSquares = { from: null, to: null };
    drawHighlights();
    updateCoachDirectionOverlay();
    runMoveAnimations(move, function () {
      const applied = chess.move(opts);
      if (!applied) {
        resetTransientPieceStyles();
        fullRedraw();
        return;
      }
      recordCapture(applied);
      updateLastMoveText();
      fullRedraw();
      resetTransientPieceStyles();
      pulseLandingSquare(applied.to);
      renderCaptures();
      setStatus();
      setUndoEnabled();
      scheduleEngineAnalyze();
    });
    return true;
  }

  function promotionModalIsOpen() {
    return promoModal && !promoModal.classList.contains("hidden");
  }

  /** Close promotion picker and put the pawn selection back so the player can choose another target. */
  function closePromotionModal() {
    if (!promoModal || promoModal.classList.contains("hidden")) return;
    promoModal.classList.add("hidden");
    if (pendingPromotion) {
      selected = pendingPromotion.from;
      pendingPromotion = null;
      drawHighlights();
      updateCoachMoveButton();
    }
  }

  function maybePromote(from, to) {
    const b = chess.board();
    const fr = parseSq(from);
    const toParsed = parseSq(to);
    if (!fr || !toParsed) return false;
    const cell = b[fr.row][fr.col];
    const stm = chess.turn();
    if (!cell || cell.type !== "p" || cell.color !== stm) return false;
    const tr = toParsed.row;
    if (stm === "w") return tr === 0;
    return tr === 7;
  }

  function openPromotion(from, to) {
    pendingPromotion = { from: from, to: to };
    promoChoices.innerHTML = "";
    const stm = chess.turn();
    const order = ["q", "r", "b", "n"];
    order.forEach(function (ptype) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "promo-btn promo-btn--" + stm;
      btn.innerHTML = pieceSvg(ptype, stm);
      btn.setAttribute("aria-label", "Promote to " + PIECE_NAMES[ptype]);
      btn.addEventListener("click", function () {
        promoModal.classList.add("hidden");
        if (pendingPromotion) {
          tryMove(pendingPromotion.from, pendingPromotion.to, ptype);
          pendingPromotion = null;
        }
        updateCoachMoveButton();
      });
      promoChoices.appendChild(btn);
    });
    promoModal.classList.remove("hidden");
    updateCoachMoveButton();
    window.requestAnimationFrame(function () {
      var first = promoChoices.querySelector(".promo-btn");
      if (first) first.focus();
    });
  }

  function onSquareClick(ev) {
    const sq = ev.currentTarget.dataset.square;
    if (chess.game_over()) return;

    const stm = chess.turn();

    if (!selected) {
      const b = chess.board();
      const parsed = parseSq(sq);
      if (!parsed) return;
      const { row, col } = parsed;
      const cell = b[row][col];
      if (cell && cell.color === stm) {
        selected = sq;
        drawHighlights();
      }
      return;
    }

    if (sq === selected) {
      selected = null;
      drawHighlights();
      return;
    }

    const legal = chess.moves({ square: selected, verbose: true });
    const pick = legal.filter(function (m) {
      return m.to === sq;
    });
    if (!pick.length) {
      const b = chess.board();
      const parsed = parseSq(sq);
      if (!parsed) return;
      const { row, col } = parsed;
      const cell = b[row][col];
      if (cell && cell.color === stm) {
        selected = sq;
        drawHighlights();
      }
      return;
    }

    if (maybePromote(selected, sq)) {
      openPromotion(selected, sq);
      return;
    }

    tryMove(selected, sq);
  }

  function rebuildCapturesFromHistory() {
    capturedByWhite = [];
    capturedByBlack = [];
    chess.history({ verbose: true }).forEach(function (m) {
      if (m.captured) {
        const capColor = m.color === "w" ? "b" : "w";
        const token = captureToken(capColor, m.captured);
        if (m.color === "w") capturedByWhite.push(token);
        else capturedByBlack.push(token);
      }
    });
  }

  function finishUndoStep() {
    rebuildCapturesFromHistory();
    selected = null;
    hintSquares = { from: null, to: null };
    lastEngineBest = null;
    updateLastMoveText();
    fullRedraw();
    renderCaptures();
    setStatus();
    scheduleEngineAnalyze();
  }

  function undoRound() {
    if (!document.body.classList.contains("is-playing")) return;
    if (chess.history().length === 0) return;
    pendingPromotion = null;
    promoModal.classList.add("hidden");
    chess.undo();
    finishUndoStep();
  }

  function rewindAllMoves() {
    if (!document.body.classList.contains("is-playing")) return;
    if (chess.history().length === 0) return;
    pendingPromotion = null;
    promoModal.classList.add("hidden");
    while (chess.history().length > 0) {
      chess.undo();
    }
    finishUndoStep();
  }

  /** Keep preview ranks/files upright under board flip (Black sits bottom visually). */
  function syncBoardOrientationForUserColor() {
    if (!arena) return;
    arena.classList.remove("board-flipped");
    if (userColor === "b") {
      arena.classList.add("board-flipped");
    }
    document.body.classList.remove("user-army-w", "user-army-b");
    document.body.classList.add(userColor === "w" ? "user-army-w" : "user-army-b");
  }

  function newGame() {
    engineAnalyzeSeq++;
    chess.reset();
    if (sf) {
      sf.stop();
      sf.send("ucinewgame");
    }
    statusPill.classList.remove("status-pill--win", "status-pill--loss", "status-pill--draw");
    selected = null;
    hintSquares = { from: null, to: null };
    lastMoveSquares = { from: null, to: null, color: null };
    capturedByWhite = [];
    capturedByBlack = [];
    pendingPromotion = null;
    promoModal.classList.add("hidden");
    boardEl.classList.remove("think-shimmer");
    updateLastMoveText();
    fullRedraw();
    renderCaptures();
    setStatus();
    setUndoEnabled();
    resetDockWinOddsPlaceholder();
    if (document.body.classList.contains("is-playing")) {
      syncBoardOrientationForUserColor();
    }
    scheduleEngineAnalyze();
  }

  /** One layout tick after arena mounts — avoids jitter without delaying the visible board. */
  function scheduleStableFitBoard() {
    window.requestAnimationFrame(fitBoard);
  }

  buildBoard();

  function enterArena() {
    if (document.body.classList.contains("is-playing")) return;
    arena.style.removeProperty("transition");
    arena.style.removeProperty("opacity");
    arena.style.removeProperty("visibility");
    const sidePick = document.querySelector('input[name="userSide"]:checked');
    userColor = sidePick && sidePick.value === "b" ? "b" : "w";
    document.body.classList.add("is-playing");
    syncBoardOrientationForUserColor();
    arena.setAttribute("aria-hidden", "false");
    if (titleScreen) titleScreen.setAttribute("aria-hidden", "true");
    setEngineStatusMessage("Monarch is waking up…");
    var engineBoot =
      typeof EngineStockfish !== "undefined" && EngineStockfish.load
        ? EngineStockfish.load()
        : Promise.reject(new Error("Stockfish loader missing"));
    newGame();
    scheduleStableFitBoard();
    if (btnNew) btnNew.focus({ preventScroll: true });
    engineBoot.then(
      function (engine) {
        sf = engine;
        setEngineStatusMessage("");
        scheduleEngineAnalyze();
      },
      function (err) {
        console.error(err);
        setEngineStatusMessage("Couldn’t wake the engine — refresh and we’ll try again.");
        updateDockWinOddsFromPayload(null, { engineMissing: true });
        if (document.body.classList.contains("is-playing") && !chess.game_over() && chess.turn() === userColor) {
          coachFallbackFromJsAi();
          updateCoachPanel();
          drawHighlights();
          updateCoachDirectionOverlay();
        }
      }
    );
  }

  function leaveArena() {
    engineAnalyzeSeq++;
    /* Hide arena immediately so resetting flip/army never paints one visible frame (felt like pieces swapping). */
    arena.style.setProperty("transition", "none");
    arena.style.setProperty("opacity", "0");
    arena.style.setProperty("visibility", "hidden");
    arena.classList.remove("board-flipped");
    document.body.classList.remove("user-army-w", "user-army-b");
    document.body.classList.remove("is-playing");
    statusPill.classList.remove("status-pill--win", "status-pill--loss", "status-pill--draw");
    arena.setAttribute("aria-hidden", "true");
    if (titleScreen) titleScreen.setAttribute("aria-hidden", "false");
    void arena.offsetHeight;
    arena.style.removeProperty("transition");
    arena.style.removeProperty("opacity");
    arena.style.removeProperty("visibility");
    cancelEngineSchedule();
    if (sf) {
      sf.stop();
    }
    sf = null;
    lastEngineBest = null;
    hideGameToastNow();
    winToastShown = false;
    btnPlay.focus();
    document.documentElement.style.removeProperty("--dock-height");
  }

  window.addEventListener("resize", function () {
    clearTimeout(boardFitTimer);
    boardFitTimer = setTimeout(fitBoard, 120);
  });

  function warmStockfishFromTitle() {
    if (typeof EngineStockfish === "undefined" || !EngineStockfish.load) return;
    EngineStockfish.load().catch(function () {});
  }

  if (btnPlay) {
    btnPlay.addEventListener("pointerenter", warmStockfishFromTitle, { passive: true });
    btnPlay.addEventListener("focusin", warmStockfishFromTitle);
  }

  document.querySelectorAll('input[name="userSide"]').forEach(function (radio) {
    radio.addEventListener("pointerenter", warmStockfishFromTitle, { passive: true });
    radio.addEventListener("change", warmStockfishFromTitle);
    radio.addEventListener("focusin", warmStockfishFromTitle);
  });

  btnPlay.addEventListener("click", enterArena);

  btnBackMenu.addEventListener("click", leaveArena);

  btnNew.addEventListener("click", function () {
    newGame();
    fitBoard();
  });
  btnUndo.addEventListener("click", undoRound);
  if (btnUndoAll) {
    btnUndoAll.addEventListener("click", rewindAllMoves);
  }

  if (btnCoachMove) {
    btnCoachMove.addEventListener("click", applyCoachMove);
  }

  if (promoCancel) {
    promoCancel.addEventListener("click", closePromotionModal);
  }

  if (promoModal) {
    promoModal.addEventListener("click", function (ev) {
      if (ev.target === promoModal) closePromotionModal();
    });
  }

  if (typeof EngineStockfish !== "undefined") {
    EngineStockfish.load().catch(function () {});
  }

  document.addEventListener("keydown", function (ev) {
    if (!document.body.classList.contains("is-playing")) return;
    const tag = (ev.target && ev.target.tagName) || "";
    const inField = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

    if (ev.key === "Escape" && promotionModalIsOpen()) {
      ev.preventDefault();
      closePromotionModal();
      return;
    }

    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && ev.key === "z" && !ev.shiftKey) {
      if (inField) return;
      ev.preventDefault();
      if (promotionModalIsOpen()) {
        closePromotionModal();
        return;
      }
      undoRound();
    }
  });
})();
