<br/>

<p align="center">
  <img src="Header.png" alt="Monarch — Sovereign · Calculated · Decisive" width="880" />
</p>

<br/>

<h1 align="center">Monarch</h1>

<p align="center">
  <strong>A chess practice app built for sovereign, calculated, decisive play — in the browser or on the desktop.</strong>
</p>

<br/>

---

## What this app is

**Monarch** is a chess practice environment built around a powerful engine running **locally** in the browser via **WebAssembly**. The UI is tuned for **deep calculation and decisive play** — free from external distractions, dashboards, or feeds.

You can use it as:

- **Web app** — served over HTTP so the engine loads correctly (opening `index.html` as a `file://` URL is blocked by design; the app warns you if you try).
- **Desktop app** — wrapped in **Electron** so it behaves like a native window on macOS, Windows, or Linux.

---

## How it works

1. **Pick your side** — choose White or Black on the title screen, then hit **Play**.
2. **Make moves on the board** — click a piece, then click a destination square. Legal moves are validated in real time by a full chess rules engine (`chess.js`).
3. **Get coached** — on **your turn**, the engine analyzes the position and highlights its recommended move with amber/teal arrows. A coach card shows the suggested move in standard notation along with a short explanation (capture, check, castle, etc.). Press **"Play your suggested move"** to execute it instantly.
4. **Move for the opponent** — Monarch is a **practice coach**, not an auto-play bot. On the opponent's turn **you** tap their pieces to make their reply, simulating real study where you consider both sides.
5. **Track the outlook** — a live **Win / Draw / Loss** percentage bar updates after every move so you can feel the position shifting.
6. **Undo & reset** — made a mistake? Use **Undo** (⌘/Ctrl+Z) to take back moves, or **Reset** to clear the board and start over.

If the WASM engine can't load (rare edge cases), a built-in **fallback AI** (minimax with alpha-beta pruning, piece-square tables, and move ordering) keeps coaching running.

---

## Why it was designed

Most chess tools either oversimplify or overload the screen. Monarch was built for a specific feeling: **regal command over the board and decisive mastery**.

The name and tagline set the tone:

| Word | In practice |
| :--- | :--- |
| **Sovereign** | You rule the board — a completely local, private environment where your vision is supreme and undisturbed. |
| **Calculated** | The engine provides deep analysis, outlooks, and plans, empowering rather than replacing your own thinking. |
| **Decisive** | Precision-focused "coach" hints that trigger at the right moments so every move you make is sharp and intentional. |

**Purpose in one line:** make high-quality, **local**, engine-backed chess practice feel sovereign, calculated, and worth returning to — without sending your games to a third-party server.

---

## Features

- **Staunton-style SVG pieces** on a dark, high-contrast board with a premium aurora background and subtle glow effects.
- **In-browser WASM chess engine** (depth 40 on your turn, depth 26 on theirs) with a **JavaScript fallback AI** if the engine can't load.
- **Coach panel** — shows the best move in SAN notation, from/to squares, and a plain-language reason (capture, check, castle, promotion, etc.).
- **Live Win / Draw / Loss outlook** — percentage bars derived from the engine's centipawn evaluation, updated in real time.
- **One-tap suggested move** — press "Play your suggested move" to instantly execute the engine's pick.
- **Captured material display** — see which pieces each side has taken at a glance.
- **Pawn promotion UI** — a modal lets you choose Queen, Rook, Bishop, or Knight when a pawn reaches the back rank.
- **Undo / Undo All / New Game** — full move-history control for study and replay.
- **Checkmate celebration** — a regal animation with particles and a halo when you deliver checkmate.
- **Responsive layout** — side-by-side board + dock on wide screens; stacked on narrow/mobile.
- **Desktop app** — the same experience wrapped in Electron as a native window on macOS, Windows, or Linux.
- **Fully local & private** — no accounts, no servers, no telemetry. Everything runs on your machine.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2a. Run in the browser
npm start
# → open http://localhost:8080

# 2b. Or run as a desktop app
npm run electron
```

See [BUILD-DESKTOP.txt](BUILD-DESKTOP.txt) for packaging installers (`.app`, `.exe`, `AppImage`).

---

## License

This project is licensed under **MIT**. Upstream libraries carry their own licenses; see their packages and bundled vendor assets for terms.

<br/>
