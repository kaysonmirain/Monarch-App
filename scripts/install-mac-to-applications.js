#!/usr/bin/env node
/**
 * Copy dist.noindex/mac-arm64/Monarch.app -> /Applications/Monarch.app
 * Removes a symlink or old bundle so Spotlight only surfaces the Applications copy.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const built = path.join(root, "dist.noindex", "mac-arm64", "Monarch.app");
const dest = "/Applications/Monarch.app";

if (!fs.existsSync(built)) {
  console.error("[install-mac] Missing:", built, "\nRun npm run dist:mac:unsigned first.");
  process.exit(1);
}

try {
  execSync(`rm -rf ${JSON.stringify(dest)}`, { stdio: "inherit" });
  execSync(`ditto ${JSON.stringify(built)} ${JSON.stringify(dest)}`, { stdio: "inherit" });
  execSync(`touch ${JSON.stringify(dest)}`, { stdio: "inherit" });
  console.log("[install-mac] Installed:", dest);
} catch (e) {
  console.error("[install-mac] Failed (try running from Terminal if permission denied).");
  process.exit(1);
}
