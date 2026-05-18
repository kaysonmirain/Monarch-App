/* global Chess */
(function (global) {
  const SF_WASM = "vendor/stockfish/stockfish-nnue-16-single.wasm";

  function stmFromFen(fen) {
    const parts = fen.split(/\s+/);
    return parts[1] === "b" ? "b" : "w";
  }

  function cpForWhite(fen, cp) {
    return stmFromFen(fen) === "w" ? cp : -cp;
  }

  function winPercentFromCpWhite(wcp) {
    return 100 / (1 + Math.pow(10, -wcp / 380));
  }

  /** UCI outputs `wdl W D L` in permille for the side to move (W = stm win, L = stm loss); convert to absolute White/Black. */
  function outlookFromWdl(fen, wdl) {
    const stm = stmFromFen(fen);
    let whiteWin;
    let draw;
    let blackWin;
    if (stm === "w") {
      whiteWin = wdl.w / 10;
      draw = wdl.d / 10;
      blackWin = wdl.l / 10;
    } else {
      whiteWin = wdl.l / 10;
      draw = wdl.d / 10;
      blackWin = wdl.w / 10;
    }
    return { whiteWin, draw, blackWin };
  }

  function firstUciToSan(fen, uciMoves) {
    if (!uciMoves || !uciMoves.length) return "—";
    const u0 = uciMoves[0];
    if (u0.length < 4) return u0;
    try {
      const c = new Chess(fen);
      const from = u0.slice(0, 2);
      const to = u0.slice(2, 4);
      const prom = u0.length > 4 ? u0[4] : undefined;
      const m = c.move({ from: from, to: to, promotion: prom });
      return m ? m.san : u0;
    } catch (e) {
      return u0;
    }
  }

  function parseInfoLine(line) {
    if (!line.startsWith("info ")) return null;
    const multipvMatch = line.match(/\bmultipv (\d+)\b/);
    const mip = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
    const depthMatch = line.match(/\bdepth (\d+)\b/);
    const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)\b/);
    const wdlMatch = line.match(/\bwdl (\d+) (\d+) (\d+)\b/);
    const pvMatch = line.match(/\bpv (.+)$/);
    if (!scoreMatch) return null;
    const pv = pvMatch ? pvMatch[1].trim().split(/\s+/).filter(Boolean) : [];
    return {
      multipv: mip,
      depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
      scoreType: scoreMatch[1],
      score: parseInt(scoreMatch[2], 10),
      wdl: wdlMatch ? { w: parseInt(wdlMatch[1], 10), d: parseInt(wdlMatch[2], 10), l: parseInt(wdlMatch[3], 10) } : null,
      pv: pv,
    };
  }

  async function boot() {
    var el = document.getElementById("stockfishLoader");
    if (!el || typeof el._exports !== "function") {
      return Promise.reject(new Error("Stockfish script missing; ensure #stockfishLoader loads first."));
    }
    var Stockfish = el._exports;
    const engine = await Stockfish({
      locateFile: function (path) {
        if (path.indexOf(".wasm") !== -1) return SF_WASM;
        return path;
      },
    });

    function send(cmd) {
      if (engine.__IS_SINGLE_THREADED__) {
        engine.onCustomMessage(cmd);
      } else {
        engine.postMessage(cmd);
      }
    }

    await new Promise(function (resolve) {
      function onLine(line) {
        if (line === "uciok") {
          engine.removeMessageListener(onLine);
          resolve();
        }
      }
      engine.addMessageListener(onLine);
      send("uci");
    });

    send("setoption name UCI_ShowWDL value true");
    send("setoption name MultiPV value 1");
    /**
     * Hash (MiB): bigger TT = stronger + faster convergence at equal time.
     * Lower to 192–256 if the tab crashes on very low-memory phones / embedded browsers.
     */
    send("setoption name Hash value 256");
    /* 20 = full strength (no artificial weakening). */
    send("setoption name Skill Level value 20");
    /* Full analysis eval / WDL; best-move quality for the coach. */
    send("setoption name UCI_AnalyseMode value true");

    await new Promise(function (resolve) {
      function onLine(line) {
        if (line === "readyok") {
          engine.removeMessageListener(onLine);
          resolve();
        }
      }
      engine.addMessageListener(onLine);
      send("isready");
    });

    let bridge = null;
    engine.addMessageListener(function (line) {
      if (bridge) bridge(line);
    });

    let goTicket = 0;
    var drainStopTimer = null;

    function parseBestmoveToken(line) {
      var m = line.match(/^bestmove\s+(\S+)/);
      if (!m) return null;
      var tok = m[1];
      if (tok === "(none)") return null;
      if (tok.length < 4) return null;
      return tok.length > 5 ? tok.slice(0, 5) : tok;
    }

    function analyze(fen, options, onPartial) {
      const ticket = ++goTicket;
      const rows = {};
      const d = options.depth || 18;
      const mt = options.movetime != null ? options.movetime : 0;
      let goCmd = "go depth " + d;
      if (mt > 0) goCmd += " movetime " + mt;

      if (drainStopTimer != null) {
        window.clearTimeout(drainStopTimer);
        drainStopTimer = null;
      }

      /**
       * UCI: after `stop`, emit `bestmove` before the next `position`/`go`. Register `bridge` *before*
       * `stop`: Stockfish WASM can deliver `bestmove` synchronously; if `bridge` is not set yet, that
       * line is dropped and the UI waits forever (no move / no outlook).
       */
      let phase = "drain_stop";
      let lastOutlookEmitMs = 0;

      function beginSearchAfterDrain() {
        if (drainStopTimer != null) {
          window.clearTimeout(drainStopTimer);
          drainStopTimer = null;
        }
        phase = "search";
        send("position fen " + fen);
        send(goCmd);
      }

      bridge = function (line) {
        if (ticket !== goTicket) return;

        if (phase === "drain_stop") {
          if (line.startsWith("bestmove")) {
            beginSearchAfterDrain();
          }
          return;
        }

        if (line.startsWith("info")) {
          const row = parseInfoLine(line);
          if (!row) return;
          rows[row.multipv] = row;
          if (row.multipv === 1) {
            const now = Date.now();
            if (now - lastOutlookEmitMs >= 72) {
              lastOutlookEmitMs = now;
              const sortedPartial = Object.keys(rows)
                .map(function (k) {
                  return rows[k];
                })
                .sort(function (a, b) {
                  return a.multipv - b.multipv;
                });
              onPartial({
                ticket: ticket,
                done: false,
                fen: fen,
                rows: rows,
                sorted: sortedPartial,
                bestmove: null,
              });
            }
          }
          return;
        }

        if (line.startsWith("bestmove")) {
          const bestmove = parseBestmoveToken(line);
          bridge = null;
          const sorted = Object.keys(rows)
            .map(function (k) {
              return rows[k];
            })
            .sort(function (a, b) {
              return a.multipv - b.multipv;
            });
          onPartial({
            ticket: ticket,
            done: true,
            fen: fen,
            rows: rows,
            sorted: sorted,
            bestmove: bestmove,
          });
        }
      };

      send("stop");

      drainStopTimer = window.setTimeout(function () {
        drainStopTimer = null;
        if (ticket !== goTicket || phase !== "drain_stop") return;
        beginSearchAfterDrain();
      }, 72);
    }

    function stop() {
      goTicket++;
      if (drainStopTimer != null) {
        window.clearTimeout(drainStopTimer);
        drainStopTimer = null;
      }
      send("stop");
      bridge = null;
    }

    return {
      analyze: analyze,
      stop: stop,
      send: send,
      outlookForUi: function (fen, row1) {
        if (!row1) return null;
        if (row1.wdl) {
          return outlookFromWdl(fen, row1.wdl);
        }
        if (row1.scoreType === "mate") {
          const stm = stmFromFen(fen);
          const m = row1.score;
          const signed = stm === "w" ? m : -m;
          if (signed > 0) {
            return { whiteWin: 99, draw: 1, blackWin: 0 };
          }
          if (signed < 0) {
            return { whiteWin: 0, draw: 1, blackWin: 99 };
          }
          return { whiteWin: 33, draw: 34, blackWin: 33 };
        }
        const cp = row1.score;
        const wcp = cpForWhite(fen, cp);
        let drawEst = Math.max(0, 24 - Math.abs(wcp) / 80);
        drawEst = Math.min(drawEst, 92);
        const mass = Math.max(0, 100 - drawEst);
        const pW = winPercentFromCpWhite(wcp);
        const pB = winPercentFromCpWhite(-wcp);
        const denom = pW + pB;
        let whiteWin;
        let blackWin;
        if (denom < 1e-6) {
          whiteWin = mass * 0.5;
          blackWin = mass * 0.5;
        } else {
          whiteWin = (mass * pW) / denom;
          blackWin = (mass * pB) / denom;
        }
        return { whiteWin: whiteWin, draw: drawEst, blackWin: blackWin };
      },
      firstUciToSan: firstUciToSan,
      cpForWhite: cpForWhite,
      stmFromFen: stmFromFen,
    };
  }

  let bootPromise = null;
  global.EngineStockfish = {
    load: function () {
      if (!bootPromise) bootPromise = boot();
      return bootPromise;
    },
  };
})(typeof window !== "undefined" ? window : this);
