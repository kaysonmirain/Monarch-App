"use strict";

/**
 * Desktop shell for Monarch: serves the static app over 127.0.0.1 so Stockfish WASM loads (no file://).
 */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

let mainWindow = null;
let server = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function staticRoot() {
  return app.isPackaged ? app.getAppPath() : __dirname;
}

function safePath(root, urlPath) {
  let p = decodeURIComponent((urlPath || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const joined = path.normalize(path.join(root, p));
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return joined;
}

function serve(root, req, res) {
  const abs = safePath(root, new URL(req.url, "http://127.0.0.1").pathname);
  if (!abs) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    if (ext === ".css" || ext === ".js" || ext === ".html") {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
    res.writeHead(200);
    res.end(data);
  });
}

function startServer(root) {
  return new Promise(function (resolve, reject) {
    const srv = http.createServer(function (req, res) {
      serve(root, req, res);
    });
    srv.listen(0, "127.0.0.1", function () {
      resolve(srv);
    });
    srv.on("error", reject);
  });
}

function windowIconPath() {
  const icns = path.join(__dirname, "build", "icon.icns");
  if (fs.existsSync(icns)) return icns;
  return path.join(__dirname, "favicon.svg");
}

function createWindow() {
  const isMac = process.platform === "darwin";
  const winOpts = {
    width: 1240,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    center: true,
    title: "Monarch",
    icon: windowIconPath(),
    backgroundColor: "#0f1210",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
  if (isMac) {
    winOpts.titleBarStyle = "hiddenInset";
    winOpts.trafficLightPosition = { x: 16, y: 16 };
  }
  mainWindow = new BrowserWindow(winOpts);

  if (isMac) {
    mainWindow.webContents.once("did-finish-load", function () {
      if (!mainWindow) return;
      mainWindow.webContents
        .executeJavaScript("document.documentElement.classList.add('is-electron-mac')")
        .catch(function () {});
    });
  }

  const port = server.address().port;
  mainWindow.loadURL("http://127.0.0.1:" + port + "/");

  mainWindow.once("ready-to-show", function () {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

if (gotSingleInstanceLock) {
  app.on("second-instance", function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async function () {
    const root = staticRoot();
    try {
      server = await startServer(root);
    } catch (e) {
      console.error(e);
      app.quit();
      return;
    }
    createWindow();

    app.on("activate", function () {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", function () {
  // Keep the static server running on macOS until quit so reopen from Dock works.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", function () {
  if (server) {
    server.close();
    server = null;
  }
});
