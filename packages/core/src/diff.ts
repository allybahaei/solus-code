import type { ChangeStats } from "./task";

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  path: string;
  /** Set when status is renamed. */
  oldPath?: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  /**
   * Unified diff for this file, from the `---`/`+++` header through its
   * hunks, so any diff renderer can take it as is.
   */
  patch: string;
}

export interface Diff {
  taskId: string;
  baseBranch: string;
  branch: string;
  files: DiffFile[];
}

export function diffStats(files: readonly DiffFile[]): ChangeStats {
  return files.reduce<ChangeStats>(
    (s, f) => ({
      files: s.files + 1,
      additions: s.additions + f.additions,
      deletions: s.deletions + f.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
