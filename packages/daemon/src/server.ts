import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { isRunnerMethod, type Runner, type ServerMessage } from "@solus/core";
import { serveStatic } from "./static";

export interface DaemonOptions {
  runner: Runner;
  /** Required on every connection. */
  token: string;
  /** 0 picks a free port. */
  port?: number;
  /** How often to check that browsers are still there. */
  heartbeatMs?: number;
  /** The built UI, to serve on the same port. */
  staticDir?: string;
}

export interface Daemon {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const HOST = "127.0.0.1";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function tokenMatches(given: string | null, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Only pages served from this machine may connect. Without this, any website
 * open in the browser could try to reach the daemon. Requests with no Origin
 * aren't from a web page, and still need the token.
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Refuses requests addressed to any other name, which is how DNS rebinding
 * would reach a local server from a website.
 */
function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function authorized(req: IncomingMessage, token: string): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  return (
    hostAllowed(req.headers.host) && originAllowed(req.headers.origin) && tokenMatches(url.searchParams.get("token"), token)
  );
}

/** Serves a Runner to browsers over WebSocket, on this machine only. */
export async function startDaemon({ runner, token, port = 0, heartbeatMs = 15_000, staticDir }: DaemonOptions): Promise<Daemon> {
  const http = createServer((req, res) => {
    if (staticDir && hostAllowed(req.headers.host)) serveStatic(staticDir, req, res);
    else res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakSet<WebSocket>();

  http.on("upgrade", (req, socket, head) => {
    if (!authorized(req, token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const unsubscribe = runner.subscribe((event) => {
    for (const ws of wss.clients) send(ws, { type: "event", event });
  });

  async function handle(ws: WebSocket, raw: string) {
    let id = -1;
    try {
      const msg = JSON.parse(raw) as { id?: unknown; method?: unknown; params?: unknown };
      if (typeof msg.id !== "number") return;
      id = msg.id;
      if (!isRunnerMethod(msg.method)) throw new Error(`Unknown method: ${String(msg.method)}`);
      const params = Array.isArray(msg.params) ? msg.params : [];
      const fn = runner[msg.method] as (...args: unknown[]) => Promise<unknown>;
      const result = await fn.apply(runner, params);
      send(ws, { type: "result", id, result });
    } catch (err) {
      send(ws, { type: "error", id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
    ws.on("message", (data) => void handle(ws, String(data)));
    ws.on("error", () => ws.terminate());
  });

  // Drop connections that stopped answering, such as a laptop that went to sleep.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, heartbeatMs);

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, HOST, resolve);
  });

  const address = http.address() as AddressInfo;
  return {
    host: address.address,
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        unsubscribe();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
