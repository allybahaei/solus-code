import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentSession } from "./agent";
import { CodexAdapter } from "./codex";

let dir: string;
let command: string;
let log: string;
let session: AgentSession | undefined;
let events: AgentEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-codex-"));
  log = join(dir, "log.jsonl");
  command = join(dir, "codex");
  writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${join(__dirname, "stand-in-codex.mjs")}" "$@"\n`);
  chmodSync(command, 0o755);
  process.env.STAND_IN_LOG = log;
  events = [];
});

afterEach(() => {
  session?.stop();
  session = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function run(prompt: string, extra: { session?: string; stallMs?: number; command?: string } = {}) {
  session = new CodexAdapter({ command: extra.command ?? command, ...(extra.stallMs ? { stallMs: extra.stallMs } : {}) }).start(
    { taskId: "t1", cwd: dir, prompt, ...(extra.session ? { session: extra.session } : {}) },
    (e) => events.push(e),
  );
  return session;
}

const saw = (type: AgentEvent["type"], count = 1) =>
  vi.waitFor(() => expect(events.filter((e) => e.type === type).length).toBeGreaterThanOrEqual(count), {
    timeout: 4000,
    interval: 10,
  });

const texts = () => events.flatMap((e) => (e.type === "text" ? [e.chunk] : []));
const launches = () =>
  readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { argv: string[] });

describe("CodexAdapter", () => {
  it("runs a turn in the workspace-write sandbox with stdin closed", async () => {
    run("Hello");
    await saw("turn_end");
    expect(texts()).toEqual(["Heard: Hello"]);
    const argv = launches()[0]?.argv ?? [];
    expect(argv.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(argv).toContain('sandbox_mode="workspace-write"');
    expect(argv).toContain('mcp_servers.solus.default_tools_approval_mode="approve"');
    expect(argv.join(" ")).not.toContain("dangerously");
  });

  it("gives instructions on the first turn only", async () => {
    const s = run("One");
    await saw("turn_end");
    s.send("Two");
    await saw("turn_end", 2);
    expect(launches()[0]?.argv.at(-1)).toContain("ask_user");
    expect(launches()[1]?.argv.at(-1)).toBe("Two");
  });

  it("resumes the thread for the next message, keeping the sandbox", async () => {
    const s = run("One");
    await saw("turn_end");
    s.send("Two");
    await saw("turn_end", 2);
    const argv = launches()[1]?.argv ?? [];
    expect(argv.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(argv).toContain("thread-1");
    expect(argv).toContain('sandbox_mode="workspace-write"');
  });

  it("resumes a saved thread from a new session", async () => {
    run("Carry on", { session: "abc" });
    await saw("turn_end");
    expect(launches()[0]?.argv).toContain("abc");
    expect(launches()[0]?.argv.at(-1)).toBe("Carry on");
  });

  it("holds messages sent mid-turn until the turn ends", async () => {
    const s = run("Start [slow]");
    await saw("session");
    s.send("Also this");
    s.send("And this");
    await saw("turn_end");
    expect(events.filter((e) => e.type === "turn_end")).toHaveLength(1);
    expect(launches()).toHaveLength(2);
    expect(launches()[1]?.argv.at(-1)).toBe("Also this\n\nAnd this");
  });

  it("asks through the real bridge without blocking", async () => {
    run("Do it [ask]");
    await saw("ask");
    expect(events.find((e) => e.type === "ask")).toMatchObject({ question: "Which one?" });
    await saw("turn_end");
  });

  it("reports a failed turn's own message", async () => {
    run("Go [fail]");
    await saw("error");
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", error: { message: "Your login expired." } }]);
  });

  it("reports a crash with its stderr", async () => {
    run("Go [crash]");
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({
      error: { message: "Codex exited unexpectedly (code 3)", detail: "something broke" },
    });
  });

  it("reports a lost session rather than an error", async () => {
    run("Carry on", { session: "gone" });
    await saw("session_lost");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("explains a missing install", async () => {
    run("Hi", { command: join(dir, "nope") });
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { message: expect.stringContaining("isn't installed") } });
  });

  it("goes stuck when a turn stops producing output", async () => {
    run("Quiet [hang]", { stallMs: 400 });
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { message: expect.stringContaining("No output") } });
  });

  it("reports nothing after being stopped", async () => {
    const s = run("Hello [slow]");
    await saw("session");
    s.stop();
    const count = events.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(events.length).toBe(count);
  });
});
