import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskState } from "@solus/core";
import type { AgentAdapter } from "./agents/agent";
import { FakeAgent } from "./agents/fake";
import { parseDiff, readDiff } from "./diff";
import { nameFromRemote } from "./git";
import { LocalRunner } from "./local-runner";
import { slugify } from "./workspace";

let dir: string;
let repo: string;
let home: string;
let runner: LocalRunner | undefined;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-test-"));
  repo = join(dir, "my-repo");
  home = join(dir, "home");
  execFileSync("mkdir", ["-p", repo]);
  sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# Hello\n");
  writeFileSync(join(repo, "app.js"), "console.log(1);\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "init");
});

afterEach(() => {
  runner?.dispose();
  runner = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const open = async () => (runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(1) }));

const newTask = (r: LocalRunner, prompt: string) =>
  r.createTask({ repo: "my-repo", title: prompt, prompt, baseBranch: "main" });

async function reaches(r: LocalRunner, id: string, state: TaskState) {
  await vi.waitFor(
    async () => expect((await r.listTasks()).find((t) => t.id === id)?.state).toBe(state),
    { timeout: 4000, interval: 10 },
  );
}

const task = async (r: LocalRunner, id: string) => (await r.snapshot()).tasks.find((t) => t.id === id);

describe("opening a repo", () => {
  it("reads the name and default branch", async () => {
    const r = await open();
    expect((await r.snapshot()).repo).toMatchObject({ name: "my-repo", defaultBranch: "main" });
  });

  it("names a repo from its remote", () => {
    expect(nameFromRemote("git@github.com:acme/storefront.git")).toBe("acme/storefront");
    expect(nameFromRemote("https://github.com/acme/storefront.git\n")).toBe("acme/storefront");
    expect(nameFromRemote("https://github.com/acme/storefront")).toBe("acme/storefront");
  });

  it("refuses a folder that isn't a repo, or has no commits", async () => {
    await expect(LocalRunner.open({ repoPath: dir, home, adapterFor: () => new FakeAgent(1) })).rejects.toThrow(/Not a git repository/);
    const empty = join(dir, "empty");
    execFileSync("mkdir", ["-p", empty]);
    sh(empty, "init", "-q");
    await expect(LocalRunner.open({ repoPath: empty, home, adapterFor: () => new FakeAgent(1) })).rejects.toThrow(/no commits/);
  });
});

describe("running a task", () => {
  it("works in its own worktree and leaves the main checkout alone", async () => {
    const r = await open();
    const t = await newTask(r, "Add a note");
    expect(t.state).toBe("idle");
    expect(t.branch).toBe("solus/add-a-note");

    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");

    expect(sh(repo, "status", "--short")).toBe("");
    expect(sh(repo, "branch", "--list", "solus/*")).toContain("solus/add-a-note");
    expect(sh(repo, "worktree", "list")).toContain(join(home, "worktrees"));

    const diff = await r.getDiff(t.id);
    expect(diff.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(["added notes/add-a-note.md", "modified README.md"]);
    expect((await task(r, t.id))?.changes).toMatchObject({ files: 2 });
  });

  it("gives tasks with the same title their own branches", async () => {
    const r = await open();
    const a = await newTask(r, "Same title");
    const b = await newTask(r, "Same title");
    expect(a.branch).toBe("solus/same-title");
    expect(b.branch).toBe("solus/same-title-2");
  });

  it("waits for an answer, then continues", async () => {
    const r = await open();
    const t = await newTask(r, "Write it [ask]");
    await r.startTask(t.id);
    await reaches(r, t.id, "needs_input");
    expect((await task(r, t.id))?.question).toMatch(/note say/);

    await r.sendMessage(t.id, "Say hello");
    await reaches(r, t.id, "ready_for_review");
    expect((await task(r, t.id))?.question).toBeUndefined();
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("notes/say-hello.md");
  });

  it("goes stuck on an agent error, and a nudge resumes it", async () => {
    const r = await open();
    const t = await newTask(r, "Break it [fail]");
    await r.startTask(t.id);
    await reaches(r, t.id, "stuck");
    expect((await task(r, t.id))?.error?.message).toMatch(/failed on purpose/);

    await r.sendMessage(t.id, "Try again");
    await reaches(r, t.id, "ready_for_review");
  });

  it("stops a working task", async () => {
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(40) });
    const t = await newTask(runner, "Slow one");
    await runner.startTask(t.id);
    await runner.stopTask(t.id);
    expect((await task(runner, t.id))?.state).toBe("stuck");
    expect((await task(runner, t.id))?.error?.message).toBe("Stopped by you");
  });

  it("sends a reviewed task back to work on a new message", async () => {
    const r = await open();
    const t = await newTask(r, "First");
    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");
    await r.sendMessage(t.id, "Second pass");
    await reaches(r, t.id, "working");
    await reaches(r, t.id, "ready_for_review");
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("notes/second-pass.md");
  });

});

describe("setup from solus.json", () => {
  const config = (value: unknown) => {
    writeFileSync(join(repo, "solus.json"), JSON.stringify(value));
  };

  it("copies listed files and runs the setup command in the worktree", async () => {
    writeFileSync(join(repo, ".env.local"), "SECRET=1\n");
    writeFileSync(join(repo, ".gitignore"), ".env.local\nsetup-ran\n");
    config({ setup: "echo installing && touch setup-ran", copy: [".env.local", "missing.txt"] });
    const r = await open();
    const t = await newTask(r, "With setup");
    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");

    const wt = join(home, "worktrees");
    const found = execFileSync("find", [wt, "-name", "setup-ran"], { encoding: "utf8" }).trim();
    expect(found).not.toBe("");
    expect(readFileSync(join(found, "..", ".env.local"), "utf8")).toBe("SECRET=1\n");
    expect((await r.snapshot()).terminal[t.id]?.join("")).toContain("installing");
  });

  it("goes stuck when setup fails, and retries on a nudge", async () => {
    config({ setup: "test -f go || (echo nope && exit 3)" });
    const r = await open();
    const t = await newTask(r, "Bad setup");
    await r.startTask(t.id);
    await reaches(r, t.id, "stuck");
    const stuck = await task(r, t.id);
    expect(stuck?.error?.message).toContain("exit 3");
    expect(stuck?.error?.detail).toContain("nope");

    config({ setup: "true" });
    await r.sendMessage(t.id, "Fixed");
    await reaches(r, t.id, "ready_for_review");
    // The agent never ran, so it must get the original task, not just the nudge.
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("notes/bad-setup-fixed.md");
  });

  it("refuses to copy files from outside the repo", async () => {
    config({ copy: ["../outside.txt"] });
    const r = await open();
    const t = await newTask(r, "Escape");
    await r.startTask(t.id);
    await reaches(r, t.id, "stuck");
    expect((await task(r, t.id))?.error?.message).toMatch(/inside the repo/);
  });
});

describe("saved state", () => {
  it("restores tasks, conversations, terminal output and diffs after a restart", async () => {
    const first = await open();
    const t = await newTask(first, "Keep me");
    await first.startTask(t.id);
    await reaches(first, t.id, "ready_for_review");
    const before = await first.snapshot();
    first.dispose();

    const second = await open();
    const after = await second.snapshot();
    expect(after.tasks).toEqual(before.tasks.map((x) => ({ ...x, lastActivityAt: expect.any(Number) })));
    expect(after.messages[t.id]?.map((m) => m.text)).toEqual(before.messages[t.id]?.map((m) => m.text));
    expect(after.terminal[t.id]).toEqual(before.terminal[t.id]);
    expect(after.diffs[t.id]?.map((f) => f.path)).toEqual(before.diffs[t.id]?.map((f) => f.path));
  });

  it("marks a task stuck if Solus restarted while it was running, and a nudge resumes it", async () => {
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(50) });
    const t = await newTask(runner, "Interrupted");
    await runner.startTask(t.id);
    runner.dispose();

    const r = await open();
    expect((await task(r, t.id))?.state).toBe("stuck");
    expect((await task(r, t.id))?.error?.message).toMatch(/restarted/);
    await r.sendMessage(t.id, "Carry on");
    await reaches(r, t.id, "ready_for_review");
  });

  it("survives a half-written last line", async () => {
    const first = await open();
    const t = await newTask(first, "Crash");
    await first.startTask(t.id);
    await reaches(first, t.id, "ready_for_review");
    first.dispose();
    const dirs = execFileSync("find", [home, "-name", `${t.id}.jsonl`, "-path", "*messages*"], { encoding: "utf8" }).trim();
    writeFileSync(dirs, readFileSync(dirs, "utf8") + '{"id":"half');

    const r = await open();
    expect((await r.snapshot()).messages[t.id]?.length).toBeGreaterThan(0);
  });
});

describe("reading diffs", () => {
  it("covers commits, edits, new, deleted and renamed files", async () => {
    sh(repo, "checkout", "-qb", "work");
    writeFileSync(join(repo, "committed.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "work");
    writeFileSync(join(repo, "app.js"), "console.log(2);\n");
    writeFileSync(join(repo, "with space.txt"), "x\n");
    unlinkSync(join(repo, "README.md"));
    renameSync(join(repo, "committed.txt"), join(repo, "moved.txt"));

    const files = await readDiff(repo, "main");
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["app.js"]).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
    expect(byPath["README.md"]).toMatchObject({ status: "deleted", deletions: 1 });
    expect(byPath["with space.txt"]).toMatchObject({ status: "added", additions: 1 });
    expect(byPath["moved.txt"]).toMatchObject({ status: "added" });
    expect(byPath["app.js"]?.patch).toContain("@@");
  });

  it("detects a rename and a binary file", () => {
    const raw = [
      "diff --git a/old.txt b/new.txt",
      "similarity index 100%",
      "rename from old.txt",
      "rename to new.txt",
      "diff --git a/logo.png b/logo.png",
      "index 111..222 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "",
    ].join("\n");
    expect(parseDiff(raw)).toMatchObject([
      { path: "new.txt", oldPath: "old.txt", status: "renamed", additions: 0 },
      { path: "logo.png", status: "modified", additions: 0, deletions: 0 },
    ]);
  });

  it("doesn't count ---/+++ header lines as changes", () => {
    const [file] = parseDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n");
    expect(file).toMatchObject({ additions: 1, deletions: 1 });
  });
});

it("makes safe slugs", () => {
  expect(slugify("Fix: the/odd ../ title!")).toBe("fix-the-odd-title");
  expect(slugify("???")).toBe("task");
});

it("starts over with the task and the latest message when the session is gone", async () => {
  const prompts: string[] = [];
  const adapter: AgentAdapter = {
    start(options, emit) {
      prompts.push(options.prompt);
      if (options.session) queueMicrotask(() => emit({ type: "session_lost" }));
      else {
        emit({ type: "session", id: "s1" });
        queueMicrotask(() => emit({ type: "turn_end" }));
      }
      return { send() {}, approve() {}, stop() {} };
    },
  };
  runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => adapter });
  const t = await newTask(runner, "Write a poem");
  await runner.startTask(t.id);
  await reaches(runner, t.id, "ready_for_review");

  // Drops the live session, as a stop or restart would.
  await runner.sendMessage(t.id, "Stop that");
  await runner.stopTask(t.id).catch(() => {});
  await reaches(runner, t.id, "stuck");
  await runner.sendMessage(t.id, "Make it short");
  await reaches(runner, t.id, "ready_for_review");
  expect(prompts.at(-1)).toBe("Write a poem\n\nMake it short");
});

describe("approvals", () => {
  const approving = (): AgentAdapter => ({
    start(_options, emit) {
      emit({ type: "session", id: "s1" });
      queueMicrotask(() => emit({ type: "approval", id: "a1", tool: "Bash", summary: "rm -rf build" }));
      return {
        send() {},
        approve(_id, allow) {
          emit({ type: "tool", tool: "Bash", text: allow ? "ran" : "skipped" });
          emit({ type: "turn_end" });
        },
        stop() {},
      };
    },
  });

  it("shows an approval as needs_input and continues once answered", async () => {
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: approving });
    const t = await newTask(runner, "Risky");
    await runner.startTask(t.id);
    await reaches(runner, t.id, "needs_input");
    expect((await task(runner, t.id))?.approval).toEqual({ id: "a1", tool: "Bash", summary: "rm -rf build" });

    await expect(runner.answerApproval(t.id, "other", true)).rejects.toThrow(/no longer waiting/);
    await runner.answerApproval(t.id, "a1", true);
    await reaches(runner, t.id, "ready_for_review");
    expect((await task(runner, t.id))?.approval).toBeUndefined();
    expect((await runner.getMessages(t.id)).map((m) => m.text)).toContain("Allowed: rm -rf build");
  });

  it("can't resume a pending approval after a restart, so goes stuck", async () => {
    const first = await LocalRunner.open({ repoPath: repo, home, adapterFor: approving });
    const t = await newTask(first, "Risky");
    await first.startTask(t.id);
    await reaches(first, t.id, "needs_input");
    first.dispose();

    const r = await open();
    expect(await task(r, t.id)).toMatchObject({ state: "stuck" });
    expect((await task(r, t.id))?.approval).toBeUndefined();
  });
});
