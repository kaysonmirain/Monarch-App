#!/usr/bin/env node
/**
 * Copies everything needed to run Monarch in a browser into ./monarch-web/
 * Zip that folder and host it (HTTPS), or upload the folder to Netlify / GitHub Pages.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "monarch-web");
const FILES = ["index.html", "favicon.svg", "apple-touch-icon.svg"];
const DIRS = ["css", "js", "vendor"];

execFileSync(process.execPath, [path.join(ROOT, "scripts", "ensure-stockfish-wasm.js")], {
  cwd: ROOT,
  stdio: "inherit",
});

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const name of FILES) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    console.error("Missing required file:", src);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(OUT, name));
}

for (const rel of DIRS) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.error("Missing required path:", src);
    process.exit(1);
  }
  fs.cpSync(src, path.join(OUT, rel), { recursive: true });
}

const wasm = path.join(OUT, "vendor", "stockfish", "stockfish-nnue-16-single.wasm");
if (!fs.existsSync(wasm) || fs.statSync(wasm).size < 400000) {
  console.error("Stockfish wasm missing or too small. Run: npm install");
  process.exit(1);
}

console.log("");
console.log("Shareable web bundle:", OUT);
console.log("  1. Zip this folder (e.g. right-click → Compress, or: zip -r monarch-web.zip monarch-web)");
console.log("  2. Upload the zip or folder to any static host (Netlify Drop, Cloudflare Pages, GitHub Pages).");
console.log("  3. Send people the site URL — phones and laptops use it in the browser.");
console.log("");
