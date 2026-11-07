import type { DiffFile, DiffFileStatus } from "@solus/core";
import { git } from "./git";
import { excludePaths } from "./merge";

const stripPrefix = (path: string) => path.replace(/\t$/, "").replace(/^[ab]\//, "");

function parseSection(section: string): DiffFile {
  const renameTo = /^rename to (.+)$/m.exec(section)?.[1];
  const renameFrom = /^rename from (.+)$/m.exec(section)?.[1];
  const added = /^new file mode /m.test(section);
  const deleted = /^deleted file mode /m.test(section);
  const status: DiffFileStatus = renameTo ? "renamed" : added ? "added" : deleted ? "deleted" : "modified";

  const newPath = /^\+\+\+ (.+)$/m.exec(section)?.[1];
  const oldPath = /^--- (.+)$/m.exec(section)?.[1];
  // Binary and mode-only changes have no ---/+++ lines, only the header.
  const header = /^diff --git a\/(.+) b\/\1$/m.exec(section)?.[1];
  const path =
    renameTo ??
    (newPath && !newPath.startsWith("/dev/null") ? stripPrefix(newPath) : undefined) ??
    (oldPath && !oldPath.startsWith("/dev/null") ? stripPrefix(oldPath) : undefined) ??
    header ??
    "";

  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of section.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) additions++;
    else if (inHunk && line.startsWith("-")) deletions++;
  }

  return { path, ...(renameFrom ? { oldPath: renameFrom } : {}), status, additions, deletions, patch: section };
}

/** Splits `git diff` output into one DiffFile per file. */
export function parseDiff(raw: string): DiffFile[] {
  return raw
    .split(/^(?=diff --git )/m)
    .filter((s) => s.startsWith("diff --git "))
    .map(parseSection);
}

const DIFF_ARGS = ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff"];

/**
 * Everything the task has changed: commits and uncommitted edits compared with
 * where the branch left the base, plus new files git doesn't track yet.
 * `exclude` leaves out files Solus copied in, which aren't the agent's work.
 */
export async function readDiff(
  worktree: string,
  baseBranch: string,
  exclude: readonly string[] = [],
  { ignoreWhitespace = false }: { ignoreWhitespace?: boolean } = {},
): Promise<DiffFile[]> {
  const base = (await git(worktree, ["merge-base", baseBranch, "HEAD"])).trim();
  const tracked = await git(worktree, [...DIFF_ARGS, "-M", ...(ignoreWhitespace ? ["-w"] : []), base]);
  const untracked = (await git(worktree, ["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...excludePaths(exclude)]))
    .split("\0")
    .filter(Boolean);

  const files = parseDiff(tracked);
  for (const path of untracked) {
    // --no-index exits 1 when the files differ, which they always do here.
    const raw = await git(worktree, [...DIFF_ARGS, "--no-index", "--", "/dev/null", path], [0, 1]);
    files.push(...parseDiff(raw));
  }
  return files;
}
