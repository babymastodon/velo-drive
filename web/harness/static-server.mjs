#!/usr/bin/env node
// harness/static-server.mjs
//
// A tiny zero-dependency static file server with correct MIME types, used by
// Playwright's `webServer` to serve `legacy-shimmed/`.
//
//   node harness/static-server.mjs <rootDir> [port]
//
// Defaults: root = ./legacy-shimmed, port = $PORT || 4178.

import {createServer} from "node:http";
import {readFile, stat} from "node:fs/promises";
import {join, normalize, extname, resolve} from "node:path";

const root = resolve(process.argv[2] || "legacy-shimmed");
const port = Number(process.argv[3] || process.env.PORT || 4178);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".zwo": "application/xml; charset=utf-8",
  ".fit": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

function safePath(urlPath) {
  // Strip query, decode, normalize, and prevent traversal outside root.
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = normalize(clean).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  return join(root, rel);
}

const server = createServer(async (req, res) => {
  try {
    let filePath = safePath(req.url || "/");
    let info;
    try {
      info = await stat(filePath);
    } catch {
      info = null;
    }
    if (info && info.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      // SPA-style fallback to index.html for unknown non-file routes.
      if (!extname(filePath)) {
        filePath = join(root, "index.html");
        info = await stat(filePath).catch(() => null);
      }
    }
    if (!info) {
      res.writeHead(404, {"content-type": "text/plain"});
      res.end("404 Not Found");
      return;
    }
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, {"content-type": "text/plain"});
    res.end("500 Internal Server Error: " + (err && err.message));
  }
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[static-server] serving ${root} at http://localhost:${port}`);
});
