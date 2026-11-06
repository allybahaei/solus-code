import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentSession } from "./agent";
import { ClaudeCodeAdapter } from "./claude-code";

let dir: string;
let command: string;
let log: string;
let session: AgentSession | undefined;
let events: AgentEvent[];
const savedEnv = { CLAUDECODE: process.env.CLAUDECODE, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-claude-"));
  log = join(dir, "log.jsonl");
  command = join(dir, "claude");
  writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${join(__dirname, "stand-in-claude.mjs")}" "$@"\n`);
  chmodSync(command, 0o755);
  process.env.STAND_IN_LOG = log;
  delete process.env.CLAUDECODE;
  delete process.env.ANTHROPIC_API_KEY;
  events = [];
});

afterEach(() => {
  session?.stop();
  session = undefined;
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  }
});

function run(prompt: string, extra: { session?: string; stallMs?: number; command?: string } = {}) {
  session = new ClaudeCodeAdapter({ command: extra.command ?? command, ...(extra.stallMs ? { stallMs: extra.stallMs } : {}) }).start(
    { taskId: "t1", cwd: dir, prompt, ...(extra.session ? { session: extra.session } : {}) },
    (e) => events.push(e),
  );
  return session;
}

const saw = (type: AgentEvent["type"]) =>
  vi.waitFor(() => expect(events.some((e) => e.type === type)).toBe(true), { timeout: 4000, interval: 10 });

const texts = () => events.flatMap((e) => (e.type === "text" ? [e.chunk] : [])).join("");
const launches = () =>
  readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; env: Record<string, string> });

describe("ClaudeCodeAdapter", () => {
  it("starts headless with the permission setup, then ends the turn", async () => {
    run("Hello");
    await saw("turn_end");
    expect(texts()).toContain("Heard: Hello");

    const argv = launches()[0]?.argv ?? [];
    const env = launches()[0]?.env ?? {};
    expect(argv).toEqual(expect.arrayContaining(["-p", "--session-id", "--mcp-config", "--permission-prompt-tool", "mcp__solus__approve"]));
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(argv).toContain("Bash(git status:*)");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(env.MCP_TOOL_TIMEOUT).toBe("86400000");
  });

  it("reports a session id and resumes with it", async () => {
    run("One");
    await saw("turn_end");
    const first = events.find((e) => e.type === "session");
    expect(first).toBeDefined();
    session?.stop();

    events = [];
    run("Two", { session: "abc-123" });
    await saw("turn_end");
    const argv = launches()[1]?.argv ?? [];
    expect(argv[argv.indexOf("--resume") + 1]).toBe("abc-123");
    expect(argv).not.toContain("--session-id");
  });

  it("reports a lost session rather than an error", async () => {
    run("Carry on", { session: "gone" });
    await saw("session_lost");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("carries on the same process for a second message", async () => {
    const s = run("One");
    await saw("turn_end");
    events = [];
    s.send("Two");
    await saw("turn_end");
    expect(texts()).toContain("Heard: Two");
    expect(launches()).toHaveLength(1);
  });

  it("asks without blocking: the tool returns at once and the turn ends", async () => {
    run("Do it [ask]");
    await saw("ask");
    expect(events.find((e) => e.type === "ask")).toMatchObject({ question: "Which one?" });
    await saw("turn_end");
    expect(texts()).toContain("End your turn now");
  });

  it("holds a command until it's allowed", async () => {
    const s = run("Go [approve]");
    await saw("approval");
    const approval = events.find((e) => e.type === "approval");
    expect(approval).toMatchObject({ tool: "Bash", summary: "rm -rf build" });
    expect(events.some((e) => e.type === "turn_end")).toBe(false);

    s.approve((approval as { id: string }).id, true);
    await saw("turn_end");
    expect(texts()).toContain('"behavior":"allow"');
    expect(texts()).toContain("rm -rf build");
  });

  it("denies with the person's words when they reply instead", async () => {
    const s = run("Go [approve]");
    await saw("approval");
    s.send("Don't delete the build folder");
    await saw("turn_end");
    expect(texts()).toContain('"behavior":"deny"');
    expect(texts()).toContain("Don't delete the build folder");
  });

  it("reports a crash with its stderr", async () => {
    run("Boom [crash]");
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({
      error: { message: "Claude Code exited unexpectedly (code 3)", detail: "something broke" },
    });
  });

  it("explains a missing install", async () => {
    run("Hi", { command: join(dir, "nope") });
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { message: expect.stringContaining("isn't installed") } });
  });

  it("goes stuck when a turn stops producing output", async () => {
    run("Quiet [hang]", { stallMs: 150 });
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { message: expect.stringContaining("No output") } });
  });

  it("doesn't count waiting for a person as a stall", async () => {
    run("Go [approve]", { stallMs: 1500 });
    await saw("approval");
    await new Promise((r) => setTimeout(r, 1800));
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("won't start inside Claude Code, and doesn't bypass the guard", async () => {
    process.env.CLAUDECODE = "1";
    run("Hi");
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { message: expect.stringContaining("normal terminal") } });
    expect(() => readFileSync(log)).toThrow();
  });

  it("warns when an API key would change the billing, and leaves it alone", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    run("Hi");
    await saw("turn_end");
    const warning = events.find((e) => e.type === "terminal");
    expect(warning).toMatchObject({ data: expect.stringContaining("ANTHROPIC_API_KEY") });
  });

  it("reports nothing after being stopped", async () => {
    const s = run("Hello");
    await saw("session");
    s.stop();
    const count = events.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(count);
  });
});
