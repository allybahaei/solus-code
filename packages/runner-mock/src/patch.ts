import type { DiffFile } from "@solus/core";

/**
 * Hunk body: one line per diff line, each starting with " ", "+" or "-".
 * A completely empty line counts as an empty context line.
 */
export interface Hunk {
  oldStart: number;
  body: string;
}

export const hunk = (oldStart: number, body: string): Hunk => ({ oldStart, body });

function hunkLines(body: string): string[] {
  const lines = body.split("\n");
  if (lines[0]?.trim() === "") lines.shift();
  if (lines.at(-1)?.trim() === "") lines.pop();
  return lines.map((l) => (l === "" ? " " : l));
}

/** Builds a modified (or renamed) file's unified diff, counting lines itself. */
export function modified(path: string, hunks: Hunk[], oldPath?: string): DiffFile {
  let additions = 0;
  let deletions = 0;
  let shift = 0;
  const out: string[] = [];
  for (const h of hunks) {
    const lines = hunkLines(h.body);
    const oldCount = lines.filter((l) => !l.startsWith("+")).length;
    const newCount = lines.filter((l) => !l.startsWith("-")).length;
    out.push(`@@ -${h.oldStart},${oldCount} +${h.oldStart + shift},${newCount} @@`, ...lines);
    additions += lines.filter((l) => l.startsWith("+")).length;
    deletions += lines.filter((l) => l.startsWith("-")).length;
    shift += newCount - oldCount;
  }
  const from = oldPath ?? path;
  const header = [
    `diff --git a/${from} b/${path}`,
    ...(oldPath ? [`rename from ${oldPath}`, `rename to ${path}`] : []),
    `--- a/${from}`,
    `+++ b/${path}`,
  ];
  return {
    path,
    ...(oldPath ? { oldPath } : {}),
    status: oldPath ? "renamed" : "modified",
    additions,
    deletions,
    patch: [...header, ...out].join("\n") + "\n",
  };
}

/** A new file; `content` is the file's text, unprefixed. */
export function added(path: string, content: string): DiffFile {
  const lines = content.replace(/^\n/, "").replace(/\n$/, "").split("\n");
  return {
    path,
    status: "added",
    additions: lines.length,
    deletions: 0,
    patch:
      [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((l) => `+${l}`),
      ].join("\n") + "\n",
  };
}
