#!/usr/bin/env node
/**
 * Stockfish’s single-thread build expects stockfish-nnue-16-single.wasm next to the JS.
 * If the binary is missing (common after clone without LFS), fetch the matching release asset.
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

const WASM_URL = "https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm";
const OUT = path.join(__dirname, "..", "vendor", "stockfish", "stockfish-nnue-16-single.wasm");
const MIN_BYTES = 400000;

function needDownload() {
  try {
    const st = fs.statSync(OUT);
    return st.size < MIN_BYTES;
  } catch {
    return true;
  }
}

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    const file = fs.createWriteStream(dest);
    https
      .get(url, function (res) {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, function () {});
          reject(new Error("HTTP " + res.statusCode + " for " + url));
          return;
        }
        res.pipe(file);
        file.on("finish", function () {
          file.close(resolve);
        });
      })
      .on("error", function (err) {
        file.close();
        fs.unlink(dest, function () {});
        reject(err);
      });
  });
}

(async function main() {
  if (!needDownload()) {
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  try {
    await download(WASM_URL, tmp);
    fs.renameSync(tmp, OUT);
    console.log("[ensure-stockfish-wasm] wrote " + OUT);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    console.warn("[ensure-stockfish-wasm] " + (e && e.message ? e.message : e));
    process.exit(0);
  }
})();
