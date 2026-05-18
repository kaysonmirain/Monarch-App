/* global Chess */
(function (global) {
  const MATE = 1e6;
  const MATERIAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  const PST_PAWN_W = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];

  const PST_KNIGHT_W = [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ];

  const PST_BISHOP_W = [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-10, 5, 5, 5, 5, 5, 5, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-10, 5, 5, 5, 5, 5, 5, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ];

  const PST_ROOK_W = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ];

  const PST_QUEEN_W = [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ];

  const PST_KING_W_MID = [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ];

  function pstTable(piece) {
    switch (piece) {
      case "p":
        return PST_PAWN_W;
      case "n":
        return PST_KNIGHT_W;
      case "b":
        return PST_BISHOP_W;
      case "r":
        return PST_ROOK_W;
      case "q":
        return PST_QUEEN_W;
      case "k":
        return PST_KING_W_MID;
      default:
        return null;
    }
  }

  function materialEnd(board) {
    let q = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[r][c];
        if (!cell || cell.type === "k") continue;
        q += MATERIAL[cell.type] || 0;
      }
    }
    return q;
  }

  function evaluateBoard(chess) {
    if (chess.in_checkmate()) {
      return chess.turn() === "w" ? -MATE : MATE;
    }
    if (chess.in_draw() || chess.in_stalemate() || chess.insufficient_material() || chess.in_threefold_repetition()) {
      return 0;
    }

    const board = chess.board();
    const endgame = materialEnd(board) < 2600;

    let score = 0;
    for (let br = 0; br < 8; br++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[br][c];
        if (!cell) continue;

        const wr = 7 - br;
        const wc = c;
        const tbl = pstTable(cell.type);
        let pst = 0;
        if (tbl) {
          const pr = cell.color === "w" ? wr : 7 - wr;
          const pc = cell.color === "w" ? wc : 7 - wc;
          pst = tbl[pr][pc];
          if (cell.type === "k" && endgame) pst *= 0.4;
        }

        const val = MATERIAL[cell.type] + pst;
        score += cell.color === "w" ? val : -val;
      }
    }

    if (chess.in_check()) {
      score += chess.turn() === "w" ? -35 : 35;
    }

    return score;
  }

  function moveScore(move, chess) {
    let s = 0;
    if (move.captured) {
      const victim = MATERIAL[move.captured] || 0;
      const attacker = MATERIAL[move.piece] || 0;
      s += 10 * victim - attacker;
    }
    if (move.flags.indexOf("p") !== -1) s += 25;
    if (move.flags.indexOf("k") !== -1 || move.flags.indexOf("q") !== -1) {
      if (move.piece === "k") s += 60;
    }
    if (move.piece === "n" || move.piece === "b") {
      const idx = "abcdefgh".indexOf(move.to[0]);
      if (idx >= 2 && idx <= 5) s += 8;
    }
    return s;
  }

  function orderedMoves(chess) {
    const moves = chess.moves({ verbose: true });
    moves.sort((a, b) => moveScore(b, chess) - moveScore(a, chess));
    return moves;
  }

  function minimax(chess, depth, alpha, beta, maximizingWhite) {
    if (depth === 0) {
      return evaluateBoard(chess);
    }

    const terminal = evaluateBoard(chess);
    if (Math.abs(terminal) >= MATE / 2) {
      return terminal;
    }

    const moves = orderedMoves(chess);
    if (moves.length === 0) {
      return evaluateBoard(chess);
    }

    if (maximizingWhite) {
      let best = -Infinity;
      for (let i = 0; i < moves.length; i++) {
        chess.move(moves[i]);
        const nextMax = chess.turn() === "w";
        const v = minimax(chess, depth - 1, alpha, beta, nextMax);
        chess.undo();
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (beta <= alpha) break;
      }
      return best;
    }

    let best = Infinity;
    for (let i = 0; i < moves.length; i++) {
      chess.move(moves[i]);
      const nextMax = chess.turn() === "w";
      const v = minimax(chess, depth - 1, alpha, beta, nextMax);
      chess.undo();
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
    return best;
  }

  function searchRoot(chess, depth, blackToMove) {
    const moves = orderedMoves(chess);
    if (moves.length === 0) return null;

    let bestMove = moves[0];
    if (blackToMove) {
      let best = Infinity;
      for (let i = 0; i < moves.length; i++) {
        chess.move(moves[i]);
        const v = minimax(chess, depth - 1, -Infinity, Infinity, chess.turn() === "w");
        chess.undo();
        if (v < best) {
          best = v;
          bestMove = moves[i];
        }
      }
    } else {
      let best = -Infinity;
      for (let i = 0; i < moves.length; i++) {
        chess.move(moves[i]);
        const v = minimax(chess, depth - 1, -Infinity, Infinity, chess.turn() === "w");
        chess.undo();
        if (v > best) {
          best = v;
          bestMove = moves[i];
        }
      }
    }
    return bestMove;
  }

  function bestMoveForSide(chess, depth, side) {
    if (chess.turn() !== side) return null;
    const d = Math.max(1, Math.min(6, depth | 0));
    return searchRoot(chess, d, side === "b");
  }

  global.ChessAI = {
    bestMoveForSide: bestMoveForSide,
    bestMoveForBot(chess, depth) {
      return bestMoveForSide(chess, depth, "b");
    },
    bestMoveForHint(chess, depth) {
      return bestMoveForSide(chess, depth, "w");
    },
  };
})(typeof window !== "undefined" ? window : this);
