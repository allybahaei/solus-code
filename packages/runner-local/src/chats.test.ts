import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAdapter, AgentEvent, AgentStart } from "./agents/agent";
import { LocalRunner } from "./local-runner";

let dir: string;
let repo: string;
let home: string;
let runner: LocalRunner | undefined;

interface Started {
  start: AgentStart;
  emit: (event: AgentEvent) => void;
  sent: string[];
  stopped: boolean;
  approved?: boolean;
}

/** An agent the test drives by hand, so two chats can be mid-turn at once. */
let started: Started[];
const adapter: AgentAdapter = {
  start(start, emit) {
    const entry: Started = { start, emit, sent: [], stopped: false };
    started.push(entry);
    return {
      send: (m) => entry.sent.push(m),
      approve: (_id, allow) => (entry.approved = allow),
      stop: () => (entry.stopped = true),
    };
  },
};

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-chats-"));
  repo = join(dir, "repo");
  home = join(dir, "home");
  sh(dir, "init", "-q", "-b", "main", repo);
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "a.txt"), "a\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "init");
  started = [];
});

afterEach(() => {
  runner?.dispose();
  runner = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const open = async () => (runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => adapter }));
const task = async (r: LocalRunner, id: string) => (await r.listTasks()).find((t) => t.id === id);
const launched = (n: number) => vi.waitFor(() => expect(started).toHaveLength(n), { timeout: 4000, interval: 5 });
const state = (r: LocalRunner, id: string, want: string) =>
  vi.waitFor(async () => expect((await task(r, id))?.state).toBe(want), { timeout: 4000, interval: 5 });

async function working(r: LocalRunner) {
  const t = await r.createTask({ repo: "repo", title: "Task", prompt: "Do the task", baseBranch: "main" });
  await r.startTask(t.id);
  await launched(1);
  return t;
}

/** A task whose main chat has finished its turn. */
async function ready(r: LocalRunner) {
  const t = await working(r);
  started[0]?.emit({ type: "turn_end" });
  await state(r, t.id, "ready_for_review");
  return t;
}

describe("chats", () => {
  it("starts every task with one chat", async () => {
    const r = await open();
    const t = await r.createTask({ repo: "repo", title: "Task", prompt: "Go", baseBranch: "main", agent: "codex" });
    expect(t.chats).toMatchObject([{ id: "main", agent: "codex", state: "idle" }]);
  });

  it("runs a new chat in the same worktree, with its own agent and none of the task's prompt", async () => {
    const r = await open();
    const t = await ready(r);
    const chat = await r.createChat(t.id, "codex");
    expect(chat).toMatchObject({ title: "New chat", agent: "codex", state: "idle" });

    await r.sendMessage(t.id, "Review this\nplease", { chat: chat.id });
    await launched(2);
    expect(started[1]?.start.cwd).toBe(started[0]?.start.cwd);
    expect(started[1]?.start.prompt).toBe("Review this\nplease");
    expect((await task(r, t.id))?.chats?.[1]?.title).toBe("Review this");
  });

  it("keeps each chat's messages apart", async () => {
    const r = await open();
    const t = await ready(r);
    const chat = await r.createChat(t.id);
    await r.sendMessage(t.id, "Hello", { chat: chat.id });
    await launched(2);
    started[0]?.emit({ type: "text", id: "a", chunk: "from main", done: true });
    started[1]?.emit({ type: "text", id: "b", chunk: "from second", done: true });
    await vi.waitFor(async () => expect(await r.getMessages(t.id)).toHaveLength(4), { timeout: 2000, interval: 5 });

    const messages = await r.getMessages(t.id);
    expect(messages.filter((m) => m.chatId === chat.id).map((m) => m.text)).toEqual(["Hello", "from second"]);
    expect(messages.filter((m) => !m.chatId).map((m) => m.text)).toEqual(["Do the task", "from main"]);
  });

  it("keeps the task working until every chat has finished, and blocks merging meanwhile", async () => {
    const r = await open();
    const t = await ready(r);
    const chat = await r.createChat(t.id);
    expect((await task(r, t.id))?.state).toBe("ready_for_review");

    await r.sendMessage(t.id, "More", { chat: chat.id });
    await launched(2);
    expect((await task(r, t.id))?.state).toBe("working");
    const merge = { targetBranch: "main", commitMessage: "x", strategy: "merge" as const };
    await expect(r.merge(t.id, merge)).rejects.toThrow(/while it is working/);

    started[1]?.emit({ type: "turn_end" });
    await state(r, t.id, "ready_for_review");
  });

  it("shows a question from any chat on the task, and routes the approval back to that chat", async () => {
    const r = await open();
    const t = await ready(r);
    const chat = await r.createChat(t.id);
    await r.sendMessage(t.id, "Run it", { chat: chat.id });
    await launched(2);
    started[1]?.emit({ type: "approval", id: "ap1", tool: "shell", summary: "ls" });
    await state(r, t.id, "needs_input");
    const seen = await task(r, t.id);
    expect(seen?.approval?.id).toBe("ap1");
    expect(seen?.chats?.[0]?.state).toBe("ready_for_review");
    expect(seen?.chats?.[1]?.approval?.id).toBe("ap1");

    await r.answerApproval(t.id, "ap1", true);
    expect(started[1]?.approved).toBe(true);
    expect(started[0]?.approved).toBeUndefined();
  });

  it("stops one chat and leaves the other running", async () => {
    const r = await open();
    const t = await working(r);
    const chat = await r.createChat(t.id);
    await r.sendMessage(t.id, "More", { chat: chat.id });
    await launched(2);

    await r.stopTask(t.id, chat.id);
    expect(started[1]?.stopped).toBe(true);
    expect(started[0]?.stopped).toBe(false);
    const seen = await task(r, t.id);
    expect(seen?.chats?.map((c) => c.state)).toEqual(["working", "stuck"]);
  });

  it("stops everything when no chat is named", async () => {
    const r = await open();
    const t = await working(r);
    const chat = await r.createChat(t.id);
    await r.sendMessage(t.id, "More", { chat: chat.id });
    await launched(2);
    await r.stopTask(t.id);
    expect(started.map((s) => s.stopped)).toEqual([true, true]);
  });

  it("prepares the worktree once when two chats start together", async () => {
    const r = await open();
    const t = await working(r);
    const chat = await r.createChat(t.id);
    await r.sendMessage(t.id, "More", { chat: chat.id });
    await launched(2);
    expect(readdirSync(join(home, "worktrees")).flatMap((k) => readdirSync(join(home, "worktrees", k)))).toHaveLength(1);
  });

  it("resumes each chat's own session after a restart", async () => {
    let r = await open();
    const t = await ready(r);
    const chat = await r.createChat(t.id);
    await r.sendMessage(t.id, "Hello", { chat: chat.id });
    await launched(2);
    started[0]?.emit({ type: "session", id: "ses-main" });
    started[1]?.emit({ type: "session", id: "ses-second" });
    started[1]?.emit({ type: "turn_end" });
    await state(r, t.id, "ready_for_review");
    r.dispose();

    r = await open();
    await r.sendMessage(t.id, "Back", { chat: chat.id });
    await r.sendMessage(t.id, "Back too");
    await launched(4);
    expect(started.slice(2).map((s) => s.start.session).sort()).toEqual(["ses-main", "ses-second"]);
  });

  it("reads tasks saved before chats existed", async () => {
    let r = await open();
    const t = await ready(r);
    started[0]?.emit({ type: "session", id: "old-session" });
    await vi.waitFor(() => expect(tasksFile()).toContain("old-session"), { timeout: 2000, interval: 5 });
    r.dispose();

    const saved = JSON.parse(readFileSync(tasksPath(), "utf8")) as { task: Record<string, unknown>; sessions?: unknown; agentSession?: string }[];
    for (const s of saved) {
      delete s.task.chats;
      delete s.sessions;
      s.agentSession = "old-session";
    }
    writeFileSync(tasksPath(), JSON.stringify(saved));

    r = await open();
    expect((await task(r, t.id))?.chats).toMatchObject([{ id: "main", state: "ready_for_review" }]);
    await r.sendMessage(t.id, "Carry on");
    await launched(2);
    expect(started[1]?.start.session).toBe("old-session");
  });

  it("refuses a chat on a task that hasn't started, and an unknown chat", async () => {
    const r = await open();
    const t = await r.createTask({ repo: "repo", title: "Idle", prompt: "Idle", baseBranch: "main" });
    await expect(r.createChat(t.id)).rejects.toThrow(/Start the task/);
    await r.startTask(t.id);
    await expect(r.sendMessage(t.id, "Hi", { chat: "nope" })).rejects.toThrow(/Unknown chat/);
  });
});

function tasksPath() {
  const [key] = readdirSync(join(home, "repos"));
  return join(home, "repos", key ?? "", "tasks.json");
}

const tasksFile = () => readFileSync(tasksPath(), "utf8");
