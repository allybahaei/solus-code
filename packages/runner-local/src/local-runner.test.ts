import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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

describe("one Solus per repo", () => {
  const openAgain = () => LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(1) });

  it("refuses a second instance while the first is running", async () => {
    await open();
    await expect(openAgain()).rejects.toThrow(/already running on this repo/);
  });

  it("frees the repo on stop", async () => {
    const first = await open();
    first.dispose();
    const second = await openAgain();
    second.dispose();
  });

  it("takes over a lock left by a crash", async () => {
    const first = await open();
    first.dispose();
    const dirs = execFileSync("find", [home, "-name", "tasks.json"], { encoding: "utf8" }).trim();
    writeFileSync(join(dirs, "..", "lock"), "999999");
    runner = await openAgain();
    expect((await runner.snapshot()).tasks).toEqual([]);
  });
});

describe("deleting a task", () => {
  it("removes the worktree, branch and history, and leaves everything else alone", async () => {
    const r = await open();
    const keep = await newTask(r, "Keep this");
    const t = await newTask(r, "Throw away");
    await r.startTask(keep.id);
    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");
    await reaches(r, keep.id, "ready_for_review");
    const events: string[] = [];
    r.subscribe((e) => events.push(e.type));

    await r.deleteTask(t.id);

    expect(events).toContain("task.deleted");
    expect((await r.listTasks()).map((x) => x.id)).toEqual([keep.id]);
    expect(sh(repo, "branch", "--list", "solus/*")).not.toContain(t.branch);
    expect(sh(repo, "branch", "--list", "solus/*")).toContain(keep.branch);
    expect(sh(repo, "branch", "--list", "main")).toContain("main");
    expect(sh(repo, "worktree", "list").trim().split("\n")).toHaveLength(2);

    r.dispose();
    const again = await open();
    expect((await again.snapshot()).tasks.map((x) => x.id)).toEqual([keep.id]);
    expect((await again.snapshot()).messages[t.id]).toBeUndefined();
  });

  it("stops a running task first", async () => {
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(40) });
    const t = await newTask(runner, "Running");
    await runner.startTask(t.id);
    await runner.deleteTask(t.id);
    expect(await runner.listTasks()).toEqual([]);
  });

  it("works on a task that never started, and one whose worktree is gone", async () => {
    const r = await open();
    const idle = await newTask(r, "Idle");
    await r.deleteTask(idle.id);

    const t = await newTask(r, "Gone");
    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");
    const wt = sh(repo, "worktree", "list", "--porcelain").match(/worktree (\S+tsk_\S+)/)?.[1] ?? "";
    rmSync(wt, { recursive: true, force: true });
    await r.deleteTask(t.id);
    expect(await r.listTasks()).toEqual([]);
    expect(sh(repo, "branch", "--list", "solus/*").trim()).toBe("");
  });

  it("refuses an unknown task", async () => {
    const r = await open();
    await expect(r.deleteTask("nope")).rejects.toThrow("Unknown task");
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

describe("saved commands", () => {
  const config = (run: unknown) => writeFileSync(join(repo, "solus.json"), JSON.stringify({ run }));
  const output = async (r: LocalRunner, id: string) => (await r.snapshot()).runOutput[id]?.join("") ?? "";

  async function ready(r: LocalRunner, title: string) {
    const t = await newTask(r, title);
    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");
    return t;
  }

  it("reads one command or several", async () => {
    config("echo hi");
    let r = await open();
    expect((await r.snapshot()).repo.actions).toEqual(["run"]);
    r.dispose();
    config({ dev: "echo dev", test: "echo test", bad: 3 });
    r = await open();
    expect((await r.snapshot()).repo.actions).toEqual(["dev", "test"]);
  });

  it("gives each task its own ports and runs in its worktree", async () => {
    config('echo "port=$SOLUS_PORT root=$SOLUS_ROOT_PATH"; pwd');
    const r = await open();
    const a = await ready(r, "One");
    const b = await ready(r, "Two");
    expect(a.port).not.toBe(b.port);
    expect(Math.abs((a.port ?? 0) - (b.port ?? 0))).toBeGreaterThanOrEqual(10);

    await r.startAction(a.id, "run");
    await vi.waitFor(async () => expect(await output(r, a.id)).toContain(`port=${a.port}`), { timeout: 4000 });
    await vi.waitFor(async () => expect(await output(r, a.id)).toContain("Exited with code 0"), { timeout: 4000 });
    expect(await output(r, a.id)).toContain(join(home, "worktrees"));
    expect((await r.listTasks()).find((t) => t.id === a.id)?.running).toBeUndefined();
  });

  it("stops the whole process tree", async () => {
    const marker = join(dir, "still-running");
    config(`(sleep 0.6; touch ${marker}) & wait`);
    const r = await open();
    const t = await ready(r, "Tree");
    await r.startAction(t.id, "run");
    expect((await r.listTasks())[0]?.running).toBe("run");
    await r.stopAction(t.id);
    await vi.waitFor(async () => expect(await output(r, t.id)).toContain("Stopped"), { timeout: 4000 });
    await new Promise((done) => setTimeout(done, 900));
    expect(existsSync(marker)).toBe(false);
  });

  it("keeps ports stable across a restart and clears what was running", async () => {
    config("sleep 30");
    const first = await open();
    const t = await ready(first, "Stable");
    await first.startAction(t.id, "run");
    first.dispose();
    const again = await open();
    const restored = (await again.listTasks())[0];
    expect(restored?.port).toBe(t.port);
    expect(restored?.running).toBeUndefined();
  });

  it("refuses unknown commands and tasks with no workspace", async () => {
    config("echo hi");
    const r = await open();
    const idle = await newTask(r, "Idle");
    await expect(r.startAction(idle.id, "run")).rejects.toThrow(/no workspace/);
    const t = await ready(r, "Done");
    await expect(r.startAction(t.id, "nope")).rejects.toThrow(/no saved command/);
  });
});

describe("archiving", () => {
  async function ready(r: LocalRunner, title: string) {
    const t = await newTask(r, title);
    await r.startTask(t.id);
    await reaches(r, t.id, "ready_for_review");
    return t;
  }
  const worktrees = () => sh(repo, "worktree", "list").trim().split("\n").length;

  it("frees the worktree but keeps the work, branch and history", async () => {
    const r = await open();
    const t = await ready(r, "Keep it");
    const before = (await r.getDiff(t.id)).files.length;
    await r.archiveTask(t.id);

    expect(worktrees()).toBe(1);
    expect(sh(repo, "log", "--format=%s", "-1", t.branch).trim()).toBe("Work in progress: Keep it");
    const snap = await r.snapshot();
    expect(snap.tasks[0]?.archivedAt).toBeGreaterThan(0);
    expect(snap.messages[t.id]?.length).toBeGreaterThan(0);
    expect((await r.getDiff(t.id)).files).toHaveLength(before);
    expect((await r.snapshot()).tasks[0]?.state).toBe("ready_for_review");
  });

  it("restores the worktree with the work in it, and the task carries on", async () => {
    const r = await open();
    const t = await ready(r, "Back again");
    await r.archiveTask(t.id);
    await r.restoreTask(t.id);

    expect(worktrees()).toBe(2);
    expect((await r.listTasks())[0]?.archivedAt).toBeUndefined();
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("notes/back-again.md");
    await r.sendMessage(t.id, "One more thing");
    await reaches(r, t.id, "ready_for_review");
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("notes/one-more-thing.md");
  });

  it("survives a restart either side", async () => {
    const first = await open();
    const t = await ready(first, "Across restarts");
    const before = (await first.getDiff(t.id)).files.length;
    await first.archiveTask(t.id);
    first.dispose();

    const r = await open();
    expect((await r.listTasks())[0]?.archivedAt).toBeGreaterThan(0);
    expect((await r.getDiff(t.id)).files).toHaveLength(before);
    await r.restoreTask(t.id);
    expect(worktrees()).toBe(2);
  });

  it("stops a running task, and refuses work until restored", async () => {
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(40) });
    const t = await newTask(runner, "Busy");
    await runner.startTask(t.id);
    await runner.archiveTask(t.id);
    expect((await runner.listTasks())[0]).toMatchObject({ state: "stuck" });
    await expect(runner.sendMessage(t.id, "Hello")).rejects.toThrow(/Restore it first/);
    await expect(runner.merge(t.id, { targetBranch: "main", commitMessage: "x", strategy: "squash" })).rejects.toThrow(/Restore it first/);
  });

  it("archives an idle task, and one already merged with its branch gone", async () => {
    const r = await open();
    const idle = await newTask(r, "Idle");
    await r.archiveTask(idle.id);
    await r.restoreTask(idle.id);
    expect((await r.listTasks())[0]?.state).toBe("idle");

    const t = await ready(r, "Landed");
    await r.merge(t.id, { targetBranch: "main", commitMessage: "Landed", strategy: "squash", deleteBranch: true });
    await r.archiveTask(t.id);
    await r.restoreTask(t.id);
    const task = (await r.listTasks()).find((x) => x.id === t.id);
    expect(task).toMatchObject({ state: "merged" });
    expect((await r.getDiff(t.id)).files.length).toBeGreaterThan(0);
  });
});
