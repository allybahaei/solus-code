import type { DiffFile } from "@solus/core";
import type { DiffSide, ReviewComment } from "./review-store";

/**
 * Agents link files by absolute path, which exposes local folders and usernames
 * if it reaches a commit or pull request. Keeps the link text, drops the path.
 */
export function stripLocalLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, "`$1`").replace(/``/g, "`");
}

/** Text of one line in a patch, by side and line number, or undefined if it isn't in a hunk. */
export function lineText(file: DiffFile, side: DiffSide, line: number): string | undefined {
  let oldLine = 0;
  let newLine = 0;
  for (const raw of file.patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (raw.startsWith("diff --git") || raw.startsWith("---") || raw.startsWith("+++") || oldLine + newLine === 0) {
      continue;
    }
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === "+") {
      if (side === "new" && newLine === line) return text;
      newLine++;
    } else if (mark === "-") {
      if (side === "old" && oldLine === line) return text;
      oldLine++;
    } else {
      if ((side === "old" && oldLine === line) || (side === "new" && newLine === line)) return text;
      oldLine++;
      newLine++;
    }
  }
  return undefined;
}

/**
 * The message "Request changes" sends to the agent. One block per comment
 * with file:line and the quoted line, so any agent can find the spot.
 */
export function formatReview(files: DiffFile[], comments: ReviewComment[], summary: string): string {
  const parts: string[] = [];
  if (comments.length > 0) {
    parts.push(`Review comments (${comments.length}):`);
    const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    for (const c of sorted) {
      const file = files.find((f) => f.path === c.path);
      const quoted = file ? lineText(file, c.side, c.line) : undefined;
      const where = `${c.path}:${c.line}${c.side === "old" ? " (removed line)" : ""}`;
      parts.push([where, ...(quoted !== undefined ? [`> ${quoted.trim()}`] : []), c.text.trim()].join("\n"));
    }
  }
  if (summary.trim()) parts.push(comments.length > 0 ? `Overall: ${summary.trim()}` : summary.trim());
  return parts.join("\n\n");
}
