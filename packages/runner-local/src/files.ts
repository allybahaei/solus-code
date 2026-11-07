import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

/** The path comes from the page, so it must not leave the worktree, even by a symlink. */
function inside(worktree: string, path: string): string {
  const root = realpathSync(worktree);
  if (isAbsolute(path)) throw new Error("That file is outside this workspace.");
  const target = join(root, path);
  // A new file has no real path yet, so its folder must check out instead.
  const real = realpathSync(existsSync(target) ? target : dirname(target));
  const rel = relative(root, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || `${sep}${rel}${sep}`.includes(`${sep}.git${sep}`)) {
    throw new Error("That file is outside this workspace.");
  }
  return target;
}

export function readWorkspaceFile(worktree: string, path: string): string {
  const target = inside(worktree, path);
  if (statSync(target).size > MAX_BYTES) throw new Error("That file is too big to edit here.");
  const bytes = readFileSync(target);
  if (bytes.includes(0)) throw new Error("That's a binary file, so it can't be edited here.");
  return bytes.toString("utf8");
}

export function writeWorkspaceFile(worktree: string, path: string, content: string): void {
  writeFileSync(inside(worktree, path), content);
}
