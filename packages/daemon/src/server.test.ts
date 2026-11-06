import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import type { RunnerEvent } from "@solus/core";
import { RemoteRunner, type ConnectionStatus } from "@solus/runner-client";
import { createMockRunner, type MockRunner } from "@solus/runner-mock";
import { startDaemon, type Daemon } from "./server";
import { resolveFile } from "./static";

const TOKEN = "test-token";

let daemon: Daemon | undefined;
let mock: MockRunner | undefined;
let client: RemoteRunner | undefined;

afterEach(async () => {
  client?.dispose();
  await daemon?.close();
  mock?.dispose();
  client = daemon = mock = undefined;
});

async function start(port = 0) {
  mock ??= createMockRunner({ speed: 50 });
  daemon = await startDaemon({ runner: mock, token: TOKEN, port });
  return daemon;
}

function connectClient(port: number, token = TOKEN) {
  client = new RemoteRunner({ url: `ws://127.0.0.1:${port}`, token, maxRetryMs: 50 });
  return client;
}

const opened = (c: RemoteRunner) =>
  vi.waitFor(() => {
    let status: ConnectionStatus | undefined;
    c.onStatus((s) => (status = s))();
    expect(status).toBe("open");
  });

/** Resolves with the HTTP status of a refused connection, or "open". */
function tryConnect(url: string, origin?: string): Promise<number | "open"> {
  return new Promise((resolve) => {
    const ws = new NodeWebSocket(url, origin ? { origin } : {});
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("error", () => {});
  });
}

describe("daemon security", () => {
  it("binds to the loopback address only", async () => {
    const { host } = await start();
    expect(host).toBe("127.0.0.1");
  });

  it("accepts the right token", async () => {
    const { port } = await start();
    await expect(tryConnect(`ws://127.0.0.1:${port}/?token=${TOKEN}`)).resolves.toBe("open");
  });

  it("refuses a missing or wrong token", async () => {
    const { port } = await start();
    await expect(tryConnect(`ws://127.0.0.1:${port}/`)).resolves.toBe(401);
    await expect(tryConnect(`ws://127.0.0.1:${port}/?token=nope`)).resolves.toBe(401);
  });

  it("refuses pages from other sites, even with the token", async () => {
    const { port } = await start();
    const url = `ws://127.0.0.1:${port}/?token=${TOKEN}`;
    await expect(tryConnect(url, "https://evil.example")).resolves.toBe(401);
    await expect(tryConnect(url, "http://localhost:3000")).resolves.toBe("open");
  });

  it("refuses methods outside the Runner API", async () => {
    const { port } = await start();
    const reply = await new Promise<string>((resolve) => {
      const ws = new NodeWebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
      ws.on("open", () => ws.send(JSON.stringify({ type: "call", id: 1, method: "dispose", params: [] })));
      ws.on("message", (d) => {
        const msg = JSON.parse(String(d));
        if (msg.id === 1) {
          ws.close();
          resolve(msg.message);
        }
      });
    });
    expect(reply).toBe("Unknown method: dispose");
  });
});

describe("serving the UI", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "solus-static-")));
    mkdirSync(join(root, "ui", "_next", "static"), { recursive: true });
    writeFileSync(join(root, "ui", "index.html"), "<h1>Solus</h1>");
    writeFileSync(join(root, "ui", "_next", "static", "a.js"), "1");
    writeFileSync(join(root, "secret.txt"), "nope");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function serve() {
    mock ??= createMockRunner({ speed: 50 });
    daemon = await startDaemon({ runner: mock, token: TOKEN, staticDir: join(root, "ui") });
    return daemon.port;
  }

  /** A raw request, because fetch would tidy a path like /../ away. */
  const get = (port: number, path: string, host = `127.0.0.1:${port}`) =>
    new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve) => {
      const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.end();
    });

  it("serves the page and its assets", async () => {
    const port = await serve();
    const page = await get(port, "/");
    expect(page).toMatchObject({ status: 200, body: "<h1>Solus</h1>" });
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect((await get(port, "/_next/static/a.js")).headers["cache-control"]).toContain("immutable");
  });

  it("won't serve files outside the UI folder", async () => {
    const port = await serve();
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/a/../../secret.txt"]) {
      const res = await get(port, path);
      expect(res.status, path).toBe(404);
      expect(res.body).not.toContain("nope");
    }
    expect(resolveFile(join(root, "ui"), "/%00")).toBeNull();
  });

  it("refuses requests addressed to another hostname", async () => {
    const port = await serve();
    expect((await get(port, "/", "evil.example")).status).toBe(404);
    expect((await get(port, "/", `localhost:${port}`)).status).toBe(200);
  });
});

describe("RemoteRunner through the daemon", () => {
  it("behaves like the runner it wraps", async () => {
    const { port } = await start();
    const c = connectClient(port);
    await opened(c);

    const snap = await c.snapshot();
    expect(snap.tasks).toHaveLength(6);

    const task = await c.createTask({ repo: "acme/storefront", title: "Add a sitemap", prompt: "Do it.", baseBranch: "main", agent: "codex" });
    expect(task.agent).toBe("codex");
    expect((await c.listTasks()).map((t) => t.id)).toContain(task.id);
  });

  it("delivers live events", async () => {
    const { port } = await start();
    const c = connectClient(port);
    const events: RunnerEvent[] = [];
    c.subscribe((e) => events.push(e));
    await opened(c);
    await c.startTask("tsk_csv_export");
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "task.state_changed" && e.to === "needs_input")).toBe(true);
    });
  });

  it("passes runner errors back to the caller", async () => {
    const { port } = await start();
    const c = connectClient(port);
    await opened(c);
    await expect(c.sendMessage("tsk_csv_export", "hi")).rejects.toThrow(/Start task/);
    await expect(c.getDiff("nope")).rejects.toThrow("Unknown task: nope");
  });

  it("fails calls while disconnected, then reconnects when the daemon returns", async () => {
    const { port } = await start();
    const c = connectClient(port);
    const seen: ConnectionStatus[] = [];
    c.onStatus((s) => seen.push(s));
    await opened(c);

    await daemon?.close();
    await vi.waitFor(() => expect(seen.at(-1)).toBe("closed"));
    await expect(c.listTasks()).rejects.toThrow("Not connected");

    await start(port);
    await opened(c);
    expect(seen.at(-1)).toBe("open");
    expect((await c.snapshot()).tasks).toHaveLength(6);
  });

  it("keeps tasks running with no browser attached", async () => {
    const { port } = await start();
    const first = connectClient(port);
    await opened(first);
    await first.startTask("tsk_csv_export");
    first.dispose();

    await vi.waitFor(async () => {
      const state = (await mock?.listTasks())?.find((t) => t.id === "tsk_csv_export")?.state;
      expect(state).toBe("needs_input");
    });

    const second = connectClient(port);
    await opened(second);
    const task = (await second.snapshot()).tasks.find((t) => t.id === "tsk_csv_export");
    expect(task?.question).toMatch(/columns/);
  });
});
