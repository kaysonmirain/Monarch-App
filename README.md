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

## Features (at a glance)

- Play full games with **Staunton-style** pieces on a dark, high-contrast board.
- Powerful **in-browser chess engine** (WASM) with a **fallback AI** if the engine cannot load.
- **Coach**-oriented controls (e.g. move suggestions, win/draw/loss outlook) aligned with how humans practice.
- **Undo / new game** flows, promotion UI, captured-material display, and status messaging suited to training.
- **Desktop** — the same experience in a native-style window on macOS, Windows, or Linux.

---

## License

This project is licensed under **ISC**. Upstream libraries carry their own licenses; see their packages and bundled vendor assets for terms.

<br/>
