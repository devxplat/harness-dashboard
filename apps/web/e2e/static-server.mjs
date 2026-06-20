// Minimal cross-platform static file server for the Next export (e2e).
// Usage: node e2e/static-server.mjs <dir> <port>
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const dir = process.argv[2] ?? "out";
const port = Number(process.argv[3] ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".map": "application/json",
};

async function resolveFile(p) {
  for (const candidate of [p, join(p, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = (await resolveFile(join(dir, urlPath))) ?? join(dir, "404.html");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, () => console.log(`static '${dir}' on http://127.0.0.1:${port}`));
