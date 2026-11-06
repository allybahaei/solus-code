import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Maps a URL to a file inside root, or null if it would escape or doesn't exist. */
export function resolveFile(root: string, url: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const file = normalize(join(root, path === "/" ? "index.html" : path));
  if (file !== root && !file.startsWith(root + sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/** Serves the built UI. Only hashed assets may be cached. */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  const file = resolveFile(root, req.url ?? "/");
  if (!file || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.includes(`${sep}_next${sep}static${sep}`) ? "public, max-age=31536000, immutable" : "no-store",
    "X-Content-Type-Options": "nosniff",
    // The app is never meant to be framed by another page.
    "X-Frame-Options": "DENY",
    // The page holds a token, so don't pass the URL on.
    "Referrer-Policy": "no-referrer",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}
