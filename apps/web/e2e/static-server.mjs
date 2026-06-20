// Minimal cross-platform static file server for the Next export (e2e).
// Proxies /api/* to the Rust server so the export is same-origin, exactly like
// the packaged binary — so e2e works with NEXT_PUBLIC_API_BASE unset (no reliance
// on a local .env.local).
// Usage: node e2e/static-server.mjs <dir> <port>   (API port via API_PORT, default 8080)
import { readFile, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { extname, join } from "node:path";

const dir = process.argv[2] ?? "out";
const port = Number(process.argv[3] ?? 4173);
const apiPort = Number(process.env.API_PORT ?? 8080);

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
  // Same-origin API: forward /api/* to the Rust server (mirrors the binary).
  if ((req.url ?? "").startsWith("/api/")) {
    const proxy = httpRequest(
      { host: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers: req.headers },
      (pr) => {
        res.writeHead(pr.statusCode ?? 502, pr.headers);
        pr.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("api proxy error");
    });
    req.pipe(proxy);
    return;
  }

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
}).listen(port, () =>
  console.log(`static '${dir}' on http://127.0.0.1:${port} (api -> 127.0.0.1:${apiPort})`),
);
