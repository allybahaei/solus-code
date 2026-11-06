import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { promisify } from "node:util";
import type { MergeStrategy } from "@solus/core";
import { branchExists, git } from "./git";

const exec = promisify(execFile);

/** git pathspecs that leave these paths out. */
export const excludePaths = (paths: readonly string[]) => paths.map((p) => `:(exclude)${p}`);

/**
 * Commits whatever the agent left uncommitted. `exclude` keeps out files Solus
 * copied in, such as .env.local, in case the repo doesn't ignore them.
 * Returns true if there was anything to commit.
 */
export async function commitAll(worktree: string, message: string, exclude: readonly string[]): Promise<boolean> {
  const merging = await isMerging(worktree);
  if (merging) await assertNoMarkers(worktree);
  await git(worktree, ["add", "-A", "--", ".", ...excludePaths(exclude)]);
  const staged = (await git(worktree, ["diff", "--cached", "--name-only"])).trim();
  // A merge must be concluded even if it ended up changing nothing.
  if (!staged && !merging) return false;
  await git(worktree, ["commit", "-m", message]);
  return true;
}

async function isMerging(worktree: string): Promise<boolean> {
  return (await git(worktree, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], [0, 1])).trim() !== "";
}

async function assertNoMarkers(worktree: string) {
  const files = (await git(worktree, ["grep", "-l", "--untracked", "-E", "^(<{7} |>{7} )"], [0, 1]))
    .split("\n")
    .filter(Boolean);
  if (files.length > 0) throw new Error(`Conflict markers are still in ${files.join(", ")}. Ask the agent to finish resolving them.`);
}

/**
 * Starts merging `target` into the task's branch and returns the conflicted
 * files. Solus does this rather than the agent because a worktree's git data
 * lives outside it: Codex's sandbox rightly can't write there, and letting it
 * would let an agent plant hooks that run outside the sandbox.
 */
export async function startMerge(worktree: string, target: string): Promise<string[]> {
  if (!(await isMerging(worktree))) await git(worktree, ["merge", "--no-edit", target], [0, 1]);
  return (await git(worktree, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
}

/** Where a branch is checked out, if anywhere. */
async function checkedOutAt(root: string, branch: string): Promise<string | null> {
  const list = await git(root, ["worktree", "list", "--porcelain"]);
  for (const block of list.split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && block.includes(`\nbranch refs/heads/${branch}\n`)) return path;
    if (path && block.endsWith(`\nbranch refs/heads/${branch}`)) return path;
  }
  return null;
}

/** Moves `target` to `commit`, which must be a descendant of it. */
async function advance(root: string, target: string, oldHead: string, commit: string) {
  const path = await checkedOutAt(root, target);
  if (!path) {
    // The old value makes this fail safely if the branch moved in the meantime.
    await git(root, ["update-ref", `refs/heads/${target}`, commit, oldHead]);
    return;
  }
  if ((await git(path, ["status", "--porcelain", "--untracked-files=no"])).trim()) {
    throw new Error(`${target} is checked out in ${path} with uncommitted changes. Commit or stash them, then merge again.`);
  }
  await git(path, ["merge", "--ff-only", commit]);
}

/** The merged tree, or an error naming the files that conflict. */
async function mergedTree(root: string, target: string, branch: string): Promise<string> {
  // Exit 1 means conflicts. Nothing on disk changes either way.
  const out = await git(root, ["merge-tree", "--write-tree", "--name-only", target, branch], [0, 1]);
  const [tree = "", ...rest] = out.split("\n");
  const blank = rest.indexOf("");
  const conflicts = rest.slice(0, blank === -1 ? rest.length : blank).filter(Boolean);
  if (conflicts.length > 0) {
    throw new Error(
      `Can't merge: ${conflicts.join(", ")} ${conflicts.length === 1 ? "conflicts" : "conflict"} with ${target}.`,
    );
  }
  return tree.trim();
}

export interface MergeInput {
  root: string;
  worktree: string;
  branch: string;
  target: string;
  message: string;
  strategy: MergeStrategy;
}

/**
 * Merges without touching any working files until a good commit exists, so a
 * conflict leaves nothing to clean up. Returns the new commit on the target.
 */
export async function mergeBranch({ root, worktree, branch, target, message, strategy }: MergeInput): Promise<string> {
  if (target === branch) throw new Error("A branch can't merge into itself.");
  if (!(await branchExists(root, target))) throw new Error(`Branch ${target} doesn't exist.`);
  const oldHead = (await git(root, ["rev-parse", `refs/heads/${target}`])).trim();

  if ((await git(root, ["rev-list", "--count", `${target}..${branch}`])).trim() === "0") {
    throw new Error(`There's nothing to merge: ${branch} has no changes that aren't already in ${target}.`);
  }

  let commit: string;
  if (strategy === "rebase") {
    await mergedTree(root, target, branch);
    try {
      await git(worktree, ["rebase", target]);
    } catch (err) {
      await git(worktree, ["rebase", "--abort"], [0, 1, 128]);
      throw err;
    }
    commit = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  } else {
    const tree = await mergedTree(root, target, branch);
    const parents = strategy === "squash" ? ["-p", target] : ["-p", target, "-p", branch];
    commit = (await git(root, ["commit-tree", tree, ...parents, "-m", message])).trim();
  }

  await advance(root, target, oldHead, commit);
  return commit;
}

/** Removes just the worktree, keeping the branch. */
export async function removeWorktree(root: string, worktree: string) {
  await git(root, ["worktree", "remove", "--force", worktree]);
  rmSync(worktree, { recursive: true, force: true });
}

/** Checks an existing branch out into a new worktree. */
export async function addWorktree(root: string, worktree: string, branch: string) {
  await git(root, ["worktree", "prune"]);
  await git(root, ["worktree", "add", worktree, branch]);
}

/** Removes a task's worktree and branch, if they still exist. Throws if git refuses. */
export async function removeWorkspace(root: string, worktree: string | undefined, branch: string, keepBranch = false) {
  if (worktree && existsSync(worktree)) {
    await git(root, ["worktree", "remove", "--force", worktree]);
    rmSync(worktree, { recursive: true, force: true });
  }
  await git(root, ["worktree", "prune"]);
  if (!keepBranch && (await branchExists(root, branch))) await git(root, ["branch", "-D", branch]);
}

export interface PullRequestInput {
  worktree: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  /** The gh executable. Tests point this at a stand-in. */
  gh?: string;
}

/** Pushes the branch and opens a pull request with the user's own gh login. */
export async function createPullRequest(input: PullRequestInput): Promise<{ url: string; number: number }> {
  const { worktree, branch, base, title, body, draft, gh = "gh" } = input;
  if (!(await git(worktree, ["remote"])).split("\n").includes("origin")) {
    throw new Error("This repo has no origin remote to open a pull request on.");
  }
  await git(worktree, ["push", "-u", "origin", branch]);

  let stdout: string;
  try {
    const args = ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body];
    ({ stdout } = await exec(gh, [...args, ...(draft ? ["--draft"] : [])], { cwd: worktree }));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error("The GitHub CLI isn't installed, or `gh` isn't on your PATH.", { cause: err });
    throw new Error(e.stderr?.trim() || e.message, { cause: err });
  }

  const url = /https?:\/\/\S+/.exec(stdout)?.[0];
  if (!url) throw new Error(`gh didn't return a pull request link: ${stdout.trim()}`);
  return { url, number: Number(/\/(\d+)\/?$/.exec(url)?.[1] ?? 0) };
}
