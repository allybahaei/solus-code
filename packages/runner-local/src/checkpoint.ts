import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";

const IDENTITY = ["-c", "user.name=Solus", "-c", "user.email=solus@localhost"];
const refsFor = (taskId: string) => `refs/solus/checkpoints/${taskId}`;

/** A throwaway index, so snapshots never touch what the agent has staged. */
async function withTempIndex<T>(work: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "solus-index-"));
  try {
    return await work({ GIT_INDEX_FILE: join(dir, "index") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function indexWorktree(worktree: string, env: NodeJS.ProcessEnv): Promise<void> {
  await git(worktree, ["read-tree", "HEAD"], [0], env);
  await git(worktree, ["add", "-A"], [0], env);
}

/**
 * Records the worktree as it is, including new files, under a ref only Solus
 * uses. Ignored files aren't included. Returns the snapshot's commit.
 */
export async function saveCheckpoint(worktree: string, taskId: string, name: string): Promise<string> {
  return withTempIndex(async (env) => {
    await indexWorktree(worktree, env);
    const tree = (await git(worktree, ["write-tree"], [0], env)).trim();
    const commit = (await git(worktree, [...IDENTITY, "commit-tree", tree, "-p", "HEAD", "-m", "Solus checkpoint"])).trim();
    await git(worktree, ["update-ref", `${refsFor(taskId)}/${name}`, commit]);
    return commit;
  });
}

/**
 * Puts the worktree and branch back as they were at the checkpoint: its files,
 * no files added since, and no commits made since.
 */
export async function restoreCheckpoint(worktree: string, commit: string): Promise<void> {
  await withTempIndex(async (env) => {
    await indexWorktree(worktree, env);
    await git(worktree, ["read-tree", "-u", "--reset", commit], [0], env);
  });
  await git(worktree, ["reset", "-q", `${commit}^`]);
}

export async function forgetCheckpoints(root: string, taskId: string): Promise<void> {
  const refs = await git(root, ["for-each-ref", "--format=%(refname)", `${refsFor(taskId)}/`]);
  for (const ref of refs.split("\n").filter(Boolean)) await git(root, ["update-ref", "-d", ref]);
}
