import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAgent } from "./agents/fake";
import { LocalRunner } from "./local-runner";

let dir: string;
let repo: string;
let home: string;
let runner: LocalRunner | undefined;

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

// The user's own shell can take seconds to load its startup files, so tests use a plain one.
const realShell = process.env.SHELL;
beforeAll(() => {
  process.env.SHELL = "/bin/sh";
});
afterAll(() => {
  process.env.SHELL = realShell;
});

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "solus-shell-")));
  repo = join(dir, "repo");
  home = join(dir, "home");
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

async function readyTask() {
  runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(1) });
  const r = runner;
  const t = await r.createTask({ repo: "repo", title: "Shell", prompt: "Shell", baseBranch: "main" });
  await r.startTask(t.id);
  await vi.waitFor(async () => expect((await r.listTasks())[0]?.state).toBe("ready_for_review"), { timeout: 4000 });
  return { r, id: t.id };
}

const output = async (r: LocalRunner, id: string) => (await r.snapshot()).terminal[id]?.join("") ?? "";

describe("the task's shell", () => {
  it("runs real commands in the worktree", async () => {
    const { r, id } = await readyTask();
    await r.writeTerminal(id, "echo MARK_$((40+2)); pwd\n");
    await vi.waitFor(async () => expect(await output(r, id)).toContain("MARK_42"), { timeout: 8000 });
    await vi.waitFor(async () => expect(await output(r, id)).toContain(join(home, "worktrees")), { timeout: 8000 });
  });

  it("uses the terminal's size", async () => {
    const { r, id } = await readyTask();
    await r.resizeTerminal(id, 101, 33);
    await r.writeTerminal(id, "stty size\n");
    await vi.waitFor(async () => expect(await output(r, id)).toContain("33 101"), { timeout: 8000 });
  });

  it("doesn't save what passes through it to disk", async () => {
    const { r, id } = await readyTask();
    await r.writeTerminal(id, "echo TOP_SECRET_$((1+1))\n");
    await vi.waitFor(async () => expect(await output(r, id)).toContain("TOP_SECRET_2"), { timeout: 8000 });
    r.dispose();
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(1) });
    expect(await output(runner, id)).not.toContain("TOP_SECRET_2");
  });

  it("starts on demand with no input, and does nothing without a worktree", async () => {
    const { r, id } = await readyTask();
    await r.writeTerminal(id, "");
    const idle = await r.createTask({ repo: "repo", title: "Idle", prompt: "Idle", baseBranch: "main" });
    await expect(r.writeTerminal(idle.id, "ls\n")).resolves.toBeUndefined();
    await expect(r.resizeTerminal(idle.id, 90, 30)).resolves.toBeUndefined();
    expect(await output(r, idle.id)).toBe("");
    await vi.waitFor(async () => expect((await output(r, id)).length).toBeGreaterThan(0));
  });

  it("goes away when the task merges", async () => {
    const { r, id } = await readyTask();
    await r.writeTerminal(id, "echo before\n");
    await vi.waitFor(async () => expect(await output(r, id)).toContain("before"), { timeout: 8000 });
    await r.merge(id, { targetBranch: "main", commitMessage: "Done", strategy: "squash", deleteBranch: true });
    await r.writeTerminal(id, "echo AFTER_$((1+1))\n");
    await new Promise((done) => setTimeout(done, 300));
    expect(await output(r, id)).not.toContain("AFTER_2");
  });
});
