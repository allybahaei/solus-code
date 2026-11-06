import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcpAdapter } from "./acp";
import type { AgentEvent, AgentSession } from "./agent";

let dir: string;
let command: string;
let session: AgentSession | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-acp-"));
  command = join(dir, "agent");
  writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${join(__dirname, "stand-in-acp.mjs")}" "$@"\n`);
  chmodSync(command, 0o755);
  vi.stubEnv("STAND_IN_LOG", join(dir, "log"));
  writeFileSync(join(dir, "log"), "");
});

afterEach(() => {
  session?.stop();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const log = () =>
  readFileSync(join(dir, "log"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method?: string; prompt?: string; decision?: { optionId: string } });

function run(prompt: string, extra: { session?: string; stallMs?: number; command?: string } = {}) {
  const events: AgentEvent[] = [];
  const { command: cmd, session: resume, stallMs } = extra;
  const adapter = new AcpAdapter({
    label: "Stand-in",
    command: cmd ?? command,
    args: ["acp"],
    login: "stand-in login",
    ...(stallMs ? { stallMs } : {}),
  });
  session = adapter.start({ taskId: "t", cwd: dir, prompt, ...(resume ? { session: resume } : {}) }, (e) => events.push(e));
  const until = (type: AgentEvent["type"]) => vi.waitFor(() => expect(events.map((e) => e.type)).toContain(type), { timeout: 5000 });
  return { events, until };
}

const text = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.chunk] : [])).join("");

describe("AcpAdapter", () => {
  it("starts a session, streams the reply and ends the turn", async () => {
    const { events, until } = run("Do it");
    await until("turn_end");
    expect(events[0]).toEqual({ type: "session", id: "ses-1" });
    expect(text(events)).toBe("Hello");
    expect(events.filter((e) => e.type === "text").at(-1)).toMatchObject({ done: true });
    expect(log().find((l) => l.prompt)?.prompt).toContain("running inside Solus");
  });

  it("takes follow-ups in the same session", async () => {
    const { events, until } = run("One");
    await until("turn_end");
    events.length = 0;
    session?.send("Two");
    await until("turn_end");
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(1);
    expect(log().at(-1)?.prompt).toBe("Two");
  });

  it("resumes without repeating the history or the instructions", async () => {
    const { events, until } = run("Carry on", { session: "ses-1" });
    await until("turn_end");
    expect(text(events)).toBe("Hello");
    expect(log().find((l) => l.prompt)?.prompt).toBe("Carry on");
  });

  it("reports a session that's gone", async () => {
    const { until } = run("Carry on", { session: "gone" });
    await until("session_lost");
  });

  it("holds an approval until the person answers, then allows it", async () => {
    const { events, until } = run("[approve]", { stallMs: 200 });
    await until("approval");
    expect(events.find((e) => e.type === "approval")).toMatchObject({ id: "call-1", tool: "shell", summary: "curl example.com" });
    // Longer than the stall limit: waiting for a person isn't stalling.
    await new Promise((r) => setTimeout(r, 300));
    expect(events.map((e) => e.type)).not.toContain("error");
    session?.approve("call-1", true);
    await until("turn_end");
    expect(log().find((l) => l.decision)?.decision?.optionId).toBe("once");
    expect(events).toContainEqual({ type: "tool", tool: "shell", text: "curl example.com" });
    expect(events).toContainEqual({ type: "terminal", data: "$ curl example.com\r\n" });
    expect(events.map((e) => e.type)).toContain("files_changed");
  });

  it("treats a message during an approval as no, then sends it", async () => {
    const { events, until } = run("[approve]");
    await until("approval");
    session?.send("Use wget instead");
    await vi.waitFor(() => expect(log().at(-1)?.prompt).toBe("Use wget instead"), { timeout: 5000 });
    expect(log().find((l) => l.decision)?.decision?.optionId).toBe("reject");
    await until("turn_end");
    expect(events).toContainEqual({ type: "tool", tool: "shell", text: "Failed: curl example.com" });
    expect(events.map((e) => e.type)).not.toContain("terminal");
  });

  it("passes on a question from the bridge", async () => {
    const { events, until } = run("[ask]");
    await until("ask");
    expect(events.find((e) => e.type === "ask")).toEqual({ type: "ask", question: "Which colour?" });
  });

  it("says how to sign in", async () => {
    const { events, until } = run("[signed-out]");
    await until("error");
    expect(events.at(-1)).toMatchObject({ error: { message: "Authentication required", detail: expect.stringContaining("stand-in login") } });
  });

  it("reports a crash with what it printed", async () => {
    const { events, until } = run("[crash]");
    await until("error");
    expect(events.at(-1)).toMatchObject({ error: { message: expect.stringContaining("code 3"), detail: "something broke" } });
  });

  it("reports a refusal", async () => {
    const { until } = run("[refuse]");
    await until("error");
  });

  it("reports silence", async () => {
    const { events, until } = run("[hang]", { stallMs: 100 });
    await until("error");
    expect(events.at(-1)).toMatchObject({ error: { message: expect.stringContaining("No output from Stand-in") } });
  });

  it("explains a missing command", async () => {
    const { events, until } = run("Hi", { command: join(dir, "nope") });
    await until("error");
    expect(events.at(-1)).toMatchObject({ error: { message: expect.stringContaining("isn't installed") } });
  });
});
