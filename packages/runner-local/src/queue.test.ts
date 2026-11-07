import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAdapter, AgentEvent, AgentSession, AgentStart } from "./agents/agent";
import { LocalRunner } from "./local-runner";

let dir: string;
let repo: string;
let runner: LocalRunner | undefined;

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** An agent the test drives by hand, one turn at a time. */
class Manual implements AgentAdapter {
  starts: AgentStart[] = [];
  sent: string[] = [];
  stops = 0;
  emit: (event: AgentEvent) => void = () => {};

  start(start: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    this.starts.push(start);
    this.emit = emit;
    emit({ type: "session", id: "s1" });
    return {
      send: (message) => this.sent.push(message),
      approve: () => {},
      stop: () => this.stops++,
    };
  }
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "solus-queue-")));
  repo = join(dir, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "t");
  sh(repo, "config", "user.email", "t@example.com");
  writeFileSync(join(repo, "README.md"), "# Hello\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "init");
});

afterEach(() => {
  runner?.dispose();
  runner = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function started() {
  const agent = new Manual();
  runner = await LocalRunner.open({ repoPath: repo, home: join(dir, "home"), adapterFor: () => agent });
  const r = runner;
  const t = await r.createTask({ repo: "repo", title: "Queue", prompt: "Begin", baseBranch: "main" });
  await r.startTask(t.id);
  await vi.waitFor(() => expect(agent.starts).toHaveLength(1), { timeout: 4000 });
  return { r, id: t.id, agent };
}

const mainChat = async (r: LocalRunner, id: string) => (await r.listTasks()).find((t) => t.id === id)?.chats?.[0];
const stateOf = async (r: LocalRunner, id: string) => (await r.listTasks()).find((t) => t.id === id)?.state;
const userMessages = async (r: LocalRunner, id: string) => (await r.getMessages(id)).filter((m) => m.role === "user").map((m) => m.text);
const endTurn = (agent: Manual) => agent.emit({ type: "turn_end" });

describe("the message queue", () => {
  it("holds messages while the agent works, without showing them as sent", async () => {
    const { r, id, agent } = await started();
    await r.sendMessage(id, "Next");
    expect((await mainChat(r, id))?.queued?.map((q) => q.text)).toEqual(["Next"]);
    expect(agent.sent).toEqual([]);
    expect(await userMessages(r, id)).toEqual(["Begin"]);
  });

  it("sends them one turn at a time, in order, then finishes", async () => {
    const { r, id, agent } = await started();
    await r.sendMessage(id, "One");
    await r.sendMessage(id, "Two");
    endTurn(agent);
    await vi.waitFor(() => expect(agent.sent).toEqual(["One"]));
    expect(await stateOf(r, id)).toBe("working");
    endTurn(agent);
    await vi.waitFor(() => expect(agent.sent).toEqual(["One", "Two"]));
    endTurn(agent);
    await vi.waitFor(async () => expect(await stateOf(r, id)).toBe("ready_for_review"));
    expect(await userMessages(r, id)).toEqual(["Begin", "One", "Two"]);
    expect((await mainChat(r, id))?.queued).toBeUndefined();
  });

  it("sends the edited text", async () => {
    const { r, id, agent } = await started();
    await r.sendMessage(id, "Typo");
    const [q] = (await mainChat(r, id))?.queued ?? [];
    await r.editQueued(id, q?.id ?? "", "Fixed");
    endTurn(agent);
    await vi.waitFor(() => expect(agent.sent).toEqual(["Fixed"]));
  });

  it("drops a removed message", async () => {
    const { r, id, agent } = await started();
    await r.sendMessage(id, "Never mind");
    const [q] = (await mainChat(r, id))?.queued ?? [];
    await r.editQueued(id, q?.id ?? "", "");
    endTurn(agent);
    await vi.waitFor(async () => expect(await stateOf(r, id)).toBe("ready_for_review"));
    expect(agent.sent).toEqual([]);
  });

  it("says so when the message has already gone", async () => {
    const { r, id } = await started();
    await expect(r.editQueued(id, "q_gone", "Late")).rejects.toThrow("already gone");
  });

  it("answers a question straight away rather than queueing", async () => {
    const { r, id, agent } = await started();
    agent.emit({ type: "ask", question: "Which?" });
    await vi.waitFor(async () => expect(await stateOf(r, id)).toBe("needs_input"));
    await r.sendMessage(id, "That one");
    expect(agent.sent).toEqual(["That one"]);
  });
});

describe("chat options", () => {
  it("restarts the session with them on the next message, resuming it", async () => {
    const { r, id, agent } = await started();
    endTurn(agent);
    await vi.waitFor(async () => expect(await stateOf(r, id)).toBe("ready_for_review"));
    await r.setChatOptions(id, { model: "large", plan: true });
    expect(agent.starts).toHaveLength(1);
    await r.sendMessage(id, "Plan it");
    await vi.waitFor(() => expect(agent.starts).toHaveLength(2));
    expect(agent.stops).toBe(1);
    expect(agent.starts[1]).toMatchObject({ session: "s1", prompt: "Plan it", options: { model: "large", plan: true } });
    expect(agent.sent).toEqual([]);
  });

  it("keeps the session when nothing changed", async () => {
    const { r, id, agent } = await started();
    endTurn(agent);
    await vi.waitFor(async () => expect(await stateOf(r, id)).toBe("ready_for_review"));
    await r.sendMessage(id, "More");
    expect(agent.sent).toEqual(["More"]);
    expect(agent.starts).toHaveLength(1);
  });

  it("applies options set mid-turn to the queued message", async () => {
    const { r, id, agent } = await started();
    await r.sendMessage(id, "Queued");
    await r.setChatOptions(id, { effort: "high" });
    endTurn(agent);
    await vi.waitFor(() => expect(agent.starts).toHaveLength(2));
    expect(agent.starts[1]?.options).toEqual({ effort: "high" });
  });
});

it("lists tracked and new files, but not ignored ones", async () => {
  const { r, id } = await started();
  const task = (await r.listTasks()).find((t) => t.id === id);
  expect(task).toBeDefined();
  const files = await r.listFiles(id);
  expect(files).toContain("README.md");
  expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
});
