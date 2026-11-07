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
const logged = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
const calls = (method: string) => logged().filter((l) => l.method === method);
const prompts = () => calls("turn/start").map((l) => l.params.input[0].text as string);

describe("CodexAdapter", () => {
  it("runs the app server in the workspace-write sandbox, with approvals", async () => {
    run("Hello");
    await saw("turn_end");
    const { argv } = logged()[0] as { argv: string[] };
    expect(argv[0]).toBe("app-server");
    expect(argv).toContain('mcp_servers.solus.default_tools_approval_mode="approve"');
    expect(argv.join(" ")).not.toContain("dangerously");
    expect(calls("thread/start")[0]?.params).toMatchObject({ sandbox: "workspace-write", approvalPolicy: "on-request", cwd: dir });
  });

  it("streams a reply as it's written, and ends it once", async () => {
    run("Hello");
    await saw("turn_end");
    expect(texts()).toEqual(["Heard: ", "Hello", ""]);
    const parts = events.filter((e) => e.type === "text");
    expect(parts.map((e) => e.done)).toEqual([false, false, true]);
    expect(new Set(parts.map((e) => e.id)).size).toBe(1);
  });

  it("shows a message that arrives whole", async () => {
    run("Go [whole]");
    await saw("turn_end");
    expect(texts()).toEqual(["All at once"]);
  });

  it("gives its instructions outside the conversation", async () => {
    run("One");
    await saw("turn_end");
    expect(calls("thread/start")[0]?.params.developerInstructions).toContain("ask_user");
    expect(prompts()).toEqual(["One"]);
  });

  it("uses one process for the whole conversation", async () => {
    const s = run("One");
    await saw("turn_end");
    s.send("Two");
    await saw("turn_end", 2);
    expect(logged().filter((l) => l.argv)).toHaveLength(1);
    expect(calls("thread/start")).toHaveLength(1);
    expect(prompts()).toEqual(["One", "Two"]);
  });

  it("resumes a saved thread from a new session", async () => {
    run("Carry on", { session: "abc" });
    await saw("turn_end");
    expect(calls("thread/resume")[0]?.params).toMatchObject({ threadId: "abc", sandbox: "workspace-write" });
    expect(prompts()).toEqual(["Carry on"]);
  });

  it("holds messages sent mid-turn until the turn ends", async () => {
    const s = run("Start [slow]");
    await saw("session");
    s.send("Also this");
    s.send("And this");
    await saw("turn_end");
    expect(events.filter((e) => e.type === "turn_end")).toHaveLength(1);
    expect(prompts()).toEqual(["Start [slow]", "Also this\n\nAnd this"]);
  });

  it("asks the person before an escalated command, and passes on a yes", async () => {
    const s = run("Go [approve]");
    await saw("approval");
    const approval = events.find((e) => e.type === "approval");
    expect(approval).toMatchObject({ tool: "Bash", summary: "curl example.com" });
    if (approval?.type === "approval") s.approve(approval.id, true);
    await saw("turn_end");
    expect(logged().find((l) => l.decision)?.decision).toBe("accept");
  });

  it("takes a message during an approval as a no, then sends it", async () => {
    const s = run("Go [approve]");
    await saw("approval");
    s.send("Don't touch the network");
    await saw("turn_end");
    expect(logged().find((l) => l.decision)?.decision).toBe("decline");
    expect(prompts().at(-1)).toBe("Don't touch the network");
  });

  it("doesn't go stuck while waiting on an approval", async () => {
    run("Go [approve]", { stallMs: 100 });
    await saw("approval");
    await new Promise((r) => setTimeout(r, 300));
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("refuses what it doesn't support, including login tokens", async () => {
    run("Go [token]");
    await saw("turn_end");
    expect(logged().find((l) => l.tokenReply)?.tokenReply.error.code).toBe(-32601);
  });

  it("explains a Codex too old for the app server", async () => {
    const old = join(dir, "old-codex");
    writeFileSync(old, "#!/bin/sh\necho \"error: unrecognized subcommand 'app-server'\" >&2\nexit 2\n");
    chmodSync(old, 0o755);
    run("Hi", { command: old });
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { message: expect.stringContaining("too old") } });
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

  it("says how to fix an expired login", async () => {
    run("Go [expired]");
    await saw("error");
    expect(events.find((e) => e.type === "error")).toMatchObject({
      error: { detail: expect.stringContaining("codex login") },
    });
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
