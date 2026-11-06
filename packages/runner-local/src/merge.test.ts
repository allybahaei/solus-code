import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MergeOptions, TaskState } from "@solus/core";
import type { AgentAdapter } from "./agents/agent";
import { FakeAgent } from "./agents/fake";
import { LocalRunner } from "./local-runner";

let dir: string;
let repo: string;
let home: string;
let runner: LocalRunner | undefined;

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-merge-"));
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

async function open(gh?: string) {
  runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => new FakeAgent(1), ...(gh ? { commands: { gh } } : {}) });
  return runner;
}

async function reaches(r: LocalRunner, id: string, state: TaskState) {
  await vi.waitFor(async () => expect((await r.listTasks()).find((t) => t.id === id)?.state).toBe(state), {
    timeout: 4000,
    interval: 10,
  });
}

/** A task the fake agent has finished, with uncommitted work in its worktree. */
async function finished(r: LocalRunner, title = "Add a note") {
  const t = await r.createTask({ repo: "repo", title, prompt: title, baseBranch: "main" });
  await r.startTask(t.id);
  await reaches(r, t.id, "ready_for_review");
  return t;
}

const opts = (over: Partial<MergeOptions> = {}): MergeOptions => ({
  targetBranch: "main",
  commitMessage: "Add a note",
  strategy: "squash",
  ...over,
});

const task = async (r: LocalRunner, id: string) => (await r.listTasks()).find((t) => t.id === id);
const log = (ref = "main") => sh(repo, "log", "--format=%s", ref).trim().split("\n");

describe("merging locally", () => {
  it("squashes the agent's uncommitted work into one commit on the checked-out branch", async () => {
    const r = await open();
    const t = await finished(r);
    await r.merge(t.id, opts());

    expect(log()).toEqual(["Add a note", "init"]);
    expect(existsSync(join(repo, "notes/add-a-note.md"))).toBe(true);
    expect(sh(repo, "status", "--short")).toBe("");
    expect(await task(r, t.id)).toMatchObject({ state: "merged", mergedInto: "main" });
  });

  it("makes a merge commit with two parents", async () => {
    const r = await open();
    const t = await finished(r);
    await r.merge(t.id, opts({ strategy: "merge", commitMessage: "Merge the note" }));
    expect(log()[0]).toBe("Merge the note");
    expect(sh(repo, "rev-list", "--parents", "-n1", "main").trim().split(" ")).toHaveLength(3);
  });

  it("rebases, keeping a straight line", async () => {
    const r = await open();
    const t = await finished(r);
    writeFileSync(join(repo, "other.txt"), "x\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "other work");

    await r.merge(t.id, opts({ strategy: "rebase" }));
    expect(log()).toEqual(["Add a note", "other work", "init"]);
    expect(sh(repo, "rev-list", "--merges", "main").trim()).toBe("");
  });

  it("merges into a branch that isn't checked out, without touching the checkout", async () => {
    sh(repo, "branch", "release");
    const r = await open();
    const t = await finished(r);
    await r.merge(t.id, opts({ targetBranch: "release" }));
    expect(log("release")[0]).toBe("Add a note");
    expect(log("main")).toEqual(["init"]);
    expect(sh(repo, "status", "--short")).toBe("");
  });

  it("refuses to move a checkout with uncommitted changes, and loses nothing", async () => {
    const r = await open();
    const t = await finished(r);
    writeFileSync(join(repo, "README.md"), "# Mine\n");

    await expect(r.merge(t.id, opts())).rejects.toThrow(/uncommitted changes/);
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# Mine\n");
    expect(log()).toEqual(["init"]);
    expect((await task(r, t.id))?.state).toBe("ready_for_review");

    sh(repo, "checkout", "README.md");
    await r.merge(t.id, opts());
    expect((await task(r, t.id))?.state).toBe("merged");
  });

  it("names conflicting files and leaves everything as it was", async () => {
    const r = await open();
    const t = await finished(r);
    writeFileSync(join(repo, "README.md"), "# Changed on main\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "main moved");
    const before = sh(repo, "rev-parse", "main");

    for (const strategy of ["squash", "merge", "rebase"] as const) {
      await expect(r.merge(t.id, opts({ strategy }))).rejects.toThrow(/README\.md conflicts with main/);
    }
    expect(sh(repo, "rev-parse", "main")).toBe(before);
    expect(sh(repo, "status", "--short")).toBe("");
    expect((await task(r, t.id))?.state).toBe("ready_for_review");
  });

  it("refuses a target that doesn't exist, and a task with no changes", async () => {
    const r = await open();
    const t = await finished(r);
    await expect(r.merge(t.id, opts({ targetBranch: "nope" }))).rejects.toThrow("Branch nope doesn't exist.");

    const idle = await r.createTask({ repo: "repo", title: "Idle", prompt: "Idle", baseBranch: "main" });
    await expect(r.merge(idle.id, opts())).rejects.toThrow(/while it is idle/);
  });

  it("never commits or shows files Solus copied in", async () => {
    writeFileSync(join(repo, ".env.local"), "SECRET=1\n");
    writeFileSync(join(repo, "solus.json"), JSON.stringify({ copy: [".env.local"] }));
    sh(repo, "add", "solus.json");
    sh(repo, "commit", "-qm", "config");

    const r = await open();
    const t = await finished(r);
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).not.toContain(".env.local");

    await r.merge(t.id, opts());
    expect(sh(repo, "show", "--stat", "--format=", "main")).not.toContain(".env.local");
  });

  it("removes the worktree and branch when asked, and keeps the review", async () => {
    const r = await open();
    const t = await finished(r);
    const before = (await r.getDiff(t.id)).files.length;
    await r.merge(t.id, opts({ deleteBranch: true }));

    expect(sh(repo, "branch", "--list", "solus/*").trim()).toBe("");
    expect(sh(repo, "worktree", "list").trim().split("\n")).toHaveLength(1);
    expect((await r.getDiff(t.id)).files).toHaveLength(before);

    r.dispose();
    const again = await open();
    expect((await again.getDiff(t.id)).files).toHaveLength(before);
  });

  it("keeps the branch when not asked to delete it", async () => {
    const r = await open();
    const t = await finished(r);
    await r.merge(t.id, opts());
    expect(sh(repo, "branch", "--list", "solus/*")).toContain(t.branch);
  });

  it("merges two tasks at once without losing either", async () => {
    const r = await open();
    const a = await finished(r, "First note");
    const b = await r.createTask({ repo: "repo", title: "Second", prompt: "Second", baseBranch: "main" });
    await r.startTask(b.id);
    await reaches(r, b.id, "ready_for_review");

    const results = await Promise.allSettled([r.merge(a.id, opts({ commitMessage: "A" })), r.merge(b.id, opts({ commitMessage: "B" }))]);
    // Both append to README.md, so the second conflicts. It must fail cleanly.
    expect(results.map((x) => x.status)).toEqual(["fulfilled", "rejected"]);
    expect(log()).toEqual(["A", "init"]);
  });
});

describe("resolving conflicts", () => {
  /** An agent that only edits files, as a sandboxed one must. */
  function resolver(fix: (cwd: string) => void): AgentAdapter {
    return {
      start({ cwd, session }, emit) {
        emit({ type: "session", id: "s1" });
        const edit = () => {
          fix(cwd);
          queueMicrotask(() => emit({ type: "turn_end" }));
        };
        if (session) edit();
        else {
          writeFileSync(join(cwd, "README.md"), "# Branch\n");
          queueMicrotask(() => emit({ type: "turn_end" }));
        }
        return { send: edit, approve() {}, stop() {} };
      },
    };
  }

  async function conflicted(fix: (cwd: string) => void) {
    runner = await LocalRunner.open({ repoPath: repo, home, adapterFor: () => resolver(fix) });
    const t = await runner.createTask({ repo: "repo", title: "Edit", prompt: "Edit", baseBranch: "main" });
    await runner.startTask(t.id);
    await reaches(runner, t.id, "ready_for_review");
    writeFileSync(join(repo, "README.md"), "# Main\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "main moved");
    return { r: runner, t };
  }

  it("merges for the agent, which only edits files, then lands cleanly", async () => {
    const { r, t } = await conflicted((cwd) => writeFileSync(join(cwd, "README.md"), "# Both\n"));
    await expect(r.merge(t.id, opts())).rejects.toThrow(/README\.md conflicts with main/);

    await r.resolveConflicts(t.id, "main");
    await reaches(r, t.id, "ready_for_review");
    expect((await r.getMessages(t.id)).at(-1)?.text).toContain("README.md");

    await r.merge(t.id, opts({ commitMessage: "Landed" }));
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# Both\n");
    expect(log()[0]).toBe("Landed");
  });

  it("refuses to land while conflict markers remain", async () => {
    const { r, t } = await conflicted(() => {});
    await r.resolveConflicts(t.id, "main");
    await reaches(r, t.id, "ready_for_review");
    await expect(r.merge(t.id, opts())).rejects.toThrow(/Conflict markers are still in README\.md/);
    expect(log()[0]).toBe("main moved");
    expect((await task(r, t.id))?.state).toBe("ready_for_review");
  });

  it("finishes by itself when nothing actually conflicts", async () => {
    const r = await open();
    const t = await finished(r);
    writeFileSync(join(repo, "other.txt"), "x\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "unrelated");
    await r.resolveConflicts(t.id, "main");
    expect((await task(r, t.id))?.state).toBe("ready_for_review");
    await r.merge(t.id, opts());
    expect(existsSync(join(repo, "other.txt"))).toBe(true);
  });
});

describe("opening a pull request", () => {
  function fakeGh(body: string) {
    const path = join(dir, "gh");
    writeFileSync(path, `#!/bin/sh\necho "$@" > "${join(dir, "gh-args")}"\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  function addRemote() {
    const bare = join(dir, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", bare]);
    sh(repo, "remote", "add", "origin", bare);
    return bare;
  }

  const pr = { title: "Add a note", body: "Why", baseBranch: "main" };

  it("commits, pushes the branch and opens the PR", async () => {
    const bare = addRemote();
    const r = await open(fakeGh("echo https://github.com/acme/repo/pull/7"));
    const t = await finished(r);

    await expect(r.openPullRequest(t.id, { ...pr, draft: true })).resolves.toEqual({ url: "https://github.com/acme/repo/pull/7" });
    expect(sh(bare, "log", "--format=%s", t.branch).trim().split("\n")[0]).toBe("Add a note");
    expect(readFileSync(join(dir, "gh-args"), "utf8")).toContain("--draft");
    expect(await task(r, t.id)).toMatchObject({ state: "ready_for_review", pullRequest: { number: 7 } });
    expect(log()).toEqual(["init"]);
  });

  describe("following it", () => {
    const view = (extra: object) =>
      JSON.stringify({
        state: "OPEN",
        mergeable: "MERGEABLE",
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [
          { name: "build", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/actions/runs/55/job/1" },
          { name: "lint", status: "IN_PROGRESS", conclusion: "" },
          { context: "deploy", state: "SUCCESS", targetUrl: "https://x/d" },
        ],
        comments: [{ id: "c1", author: { login: "sam" }, body: "Why?", url: "https://x/c1" }],
        reviews: [{ id: "r1", author: { login: "sam" }, body: "", url: "https://x/r1" }],
        ...extra,
      });
    const stub = (extra: object = {}) =>
      fakeGh(`case "$1 $2" in
  "pr create") echo https://github.com/acme/repo/pull/7;;
  "pr view") echo '${view(extra)}';;
  "pr merge") echo merged;;
  "run view") printf 'one\\ntwo\\n';;
  api*) echo '[{"id":3,"user":{"login":"kim"},"body":"Rename","path":"a.ts","line":4,"html_url":"https://x/3"}]';;
esac`);
    const opened = async (gh: string) => {
      const bare = addRemote();
      const r = await open(gh);
      const t = await finished(r);
      await r.openPullRequest(t.id, pr);
      return { r, t, bare };
    };

    it("reads checks and every kind of comment", async () => {
      const { r, t } = await opened(stub());
      await expect(r.getPullRequest(t.id)).resolves.toEqual({
        state: "open",
        conflicts: false,
        reviewDecision: "CHANGES_REQUESTED",
        checks: [
          { name: "build", state: "failed", url: "https://x/actions/runs/55/job/1" },
          { name: "lint", state: "pending" },
          { name: "deploy", state: "passed", url: "https://x/d" },
        ],
        comments: [
          { id: "c1", author: "sam", body: "Why?", url: "https://x/c1" },
          { id: "3", author: "kim", body: "Rename", path: "a.ts", line: 4, url: "https://x/3" },
        ],
      });
      await expect(r.getCheckLog(t.id, "https://x/actions/runs/55/job/1")).resolves.toBe("one\ntwo");
      await expect(r.getCheckLog(t.id, "https://ci.example/9")).resolves.toBe("");
    });

    it("sends follow-up work to the same pull request", async () => {
      const { r, t, bare } = await opened(stub());
      await r.sendMessage(t.id, "Rename it");
      await reaches(r, t.id, "ready_for_review");
      await r.pushPullRequest(t.id);
      expect(sh(bare, "log", "--format=%s", t.branch).split("\n")[0]).toBe(`Update ${t.title}`);
    });

    it("pushes new work before merging, and ends the task", async () => {
      const { r, t, bare } = await opened(stub());
      await r.sendMessage(t.id, "One more thing");
      await reaches(r, t.id, "ready_for_review");
      await r.mergePullRequest(t.id, "squash");
      expect(readFileSync(join(dir, "gh-args"), "utf8")).toContain("--squash");
      expect(sh(bare, "log", "--format=%s", t.branch).split("\n")[0]).toBe(`Update ${t.title}`);
      expect(await task(r, t.id)).toMatchObject({ state: "merged", mergedInto: "main" });
    });

    it("notices a pull request merged on GitHub", async () => {
      const { r, t } = await opened(stub({ state: "MERGED" }));
      await r.getPullRequest(t.id);
      expect(await task(r, t.id)).toMatchObject({ state: "merged", mergedInto: "main" });
    });

    it("needs a pull request", async () => {
      const r = await open();
      const t = await finished(r);
      await expect(r.getPullRequest(t.id)).rejects.toThrow(/no pull request/);
      await expect(r.pushPullRequest(t.id)).rejects.toThrow(/no pull request/);
    });
  });

  it("explains a repo with no remote", async () => {
    const r = await open(fakeGh("exit 0"));
    const t = await finished(r);
    await expect(r.openPullRequest(t.id, pr)).rejects.toThrow(/no origin remote/);
    expect((await task(r, t.id))?.state).toBe("ready_for_review");
  });

  it("explains a missing gh", async () => {
    addRemote();
    const r = await open(join(dir, "missing-gh"));
    const t = await finished(r);
    await expect(r.openPullRequest(t.id, pr)).rejects.toThrow(/GitHub CLI isn't installed/);
  });

  it("passes on gh's own error", async () => {
    addRemote();
    const r = await open(fakeGh('echo "not logged in" >&2; exit 1'));
    const t = await finished(r);
    await expect(r.openPullRequest(t.id, pr)).rejects.toThrow("not logged in");
    expect((await task(r, t.id))?.state).toBe("ready_for_review");
  });
});

describe("starting from something that exists", () => {
  const gh = (script: string) => {
    const path = join(dir, "gh");
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const start = async (r: LocalRunner, id: string) => {
    await r.startTask(id);
    await reaches(r, id, "ready_for_review");
  };
  const ghWithIssues = `case "$1 $2" in
  "issue view") echo '{"title":"Login is broken","body":"Steps to reproduce","url":"https://x/1"}';;
  "pr view") echo '{"title":"Add search","body":"Why","baseRefName":"main","headRefName":"contrib","isCrossRepository":false,"url":"https://x/9","headRefOid":"abc"}';;
  "pr list") echo '[{"number":9,"title":"Add search"}]';;
  "issue list") echo '[{"number":1,"title":"Login is broken"}]';;
esac`;

  it("lists branches, PRs and issues, leaving out the default and Solus's own", async () => {
    sh(repo, "branch", "feature/a");
    const r = await open(gh(ghWithIssues));
    await finished(r);
    await expect(r.listSources()).resolves.toEqual({
      branches: ["feature/a"],
      pullRequests: [{ number: 9, title: "Add search" }],
      issues: [{ number: 1, title: "Login is broken" }],
    });
  });

  it("still lists branches without gh", async () => {
    sh(repo, "branch", "feature/a");
    const r = await open(join(dir, "no-gh"));
    await expect(r.listSources()).resolves.toMatchObject({ branches: ["feature/a"], pullRequests: [], issues: [] });
  });

  it("works on an existing branch, and deleting the task keeps that branch", async () => {
    sh(repo, "checkout", "-qb", "feature/mine");
    writeFileSync(join(repo, "mine.txt"), "x\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "my work");
    sh(repo, "checkout", "-q", "main");

    const r = await open();
    const t = await r.createTask({ repo: "repo", title: "", prompt: "Carry on", baseBranch: "main", source: { type: "branch", branch: "feature/mine" } });
    expect(t.branch).toBe("feature/mine");
    await start(r, t.id);
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("mine.txt");

    await r.deleteTask(t.id);
    expect(sh(repo, "branch", "--list", "feature/mine")).toContain("feature/mine");
  });

  it("refuses the default branch, a missing branch, and a branch already in use", async () => {
    sh(repo, "branch", "feature/a");
    const r = await open();
    const input = (branch: string) => ({ repo: "repo", title: "", prompt: "", baseBranch: "main", source: { type: "branch" as const, branch } });
    await expect(r.createTask(input("main"))).rejects.toThrow(/directly on main/);
    await expect(r.createTask(input("nope"))).rejects.toThrow(/doesn't exist/);
    await r.createTask(input("feature/a"));
    await expect(r.createTask(input("feature/a"))).rejects.toThrow(/already using/);
  });

  it("starts from an issue with its text as the task", async () => {
    const r = await open(gh(ghWithIssues));
    const t = await r.createTask({ repo: "repo", title: "", prompt: "Check Safari too", baseBranch: "main", source: { type: "issue", number: 1 } });
    expect(t.title).toBe("#1: Login is broken");
    expect(t.branch).toBe("solus/1-login-is-broken");
    expect(t.prompt).toContain("Steps to reproduce");
    expect(t.prompt).toContain("Check Safari too");
  });

  it("checks out a PR's branch", async () => {
    const bare = join(dir, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", bare]);
    sh(repo, "remote", "add", "origin", bare);
    sh(repo, "push", "-q", "origin", "main");
    sh(repo, "checkout", "-qb", "contrib");
    writeFileSync(join(repo, "contrib.txt"), "x\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "contribution");
    sh(repo, "push", "-q", "origin", "HEAD:refs/pull/9/head");
    sh(repo, "checkout", "-q", "main");

    const r = await open(gh(ghWithIssues));
    const t = await r.createTask({ repo: "repo", title: "", prompt: "", baseBranch: "main", source: { type: "pr", number: 9 } });
    expect(t.branch).toBe("solus/pr-9");
    await expect(r.createTask({ repo: "repo", title: "", prompt: "", baseBranch: "main", source: { type: "pr", number: 9 } })).rejects.toThrow(/PR #9/);
    await start(r, t.id);
    expect((await r.getDiff(t.id)).files.map((f) => f.path)).toContain("contrib.txt");

    await r.pushPullRequest(t.id);
    expect(sh(bare, "log", "--format=%s", "contrib").split("\n")[0]).toBe(`Update ${t.title}`);
  });

  it("explains a missing gh when one is needed", async () => {
    const r = await open(join(dir, "no-gh"));
    await expect(r.createTask({ repo: "repo", title: "", prompt: "", baseBranch: "main", source: { type: "issue", number: 1 } })).rejects.toThrow(/GitHub CLI/);
  });
});

describe("attachments", () => {
  it("are readable in the worktree, but never shown or committed", async () => {
    const r = await open();
    const t = await finished(r);
    const path = await r.attachFile(t.id, "../../evil name.png", Buffer.from("image").toString("base64"));
    expect(path).toMatch(/^\.solus-attachments\/\d+-evil-name\.png$/);

    await r.sendMessage(t.id, "See the file");
    await reaches(r, t.id, "ready_for_review");
    expect((await r.getDiff(t.id)).files.map((f) => f.path).join()).not.toContain("solus-attachments");

    const worktree = sh(repo, "worktree", "list", "--porcelain").split("\n").find((l) => l.includes(t.id))?.replace("worktree ", "") ?? "";
    sh(worktree, "add", "-A");
    expect(sh(worktree, "diff", "--cached", "--name-only")).not.toContain("solus-attachments");

    await r.merge(t.id, opts());
    expect(sh(repo, "ls-files")).not.toContain("solus-attachments");
  });

  it("need a started task", async () => {
    const r = await open();
    const t = await r.createTask({ repo: "repo", title: "Idle", prompt: "Idle", baseBranch: "main" });
    await expect(r.attachFile(t.id, "a.png", "")).rejects.toThrow(/once the task has started/);
  });
});
