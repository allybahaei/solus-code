"use client";

import { Check, Eye, MessageSquare } from "lucide-react";
import type { DiffFile, Task } from "@solus/core";
import { splitPath } from "@/lib/format";
import { reviewOf, useReview } from "@/lib/review-store";
import { cn } from "@/lib/utils";

const STATUS: Record<DiffFile["status"], { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-diff-add", label: "Added" },
  modified: { letter: "M", className: "text-state-needs-input", label: "Modified" },
  deleted: { letter: "D", className: "text-diff-del", label: "Deleted" },
  renamed: { letter: "R", className: "text-state-working", label: "Renamed" },
};

/**
 * Files changed in the task's worktree. Clicking one opens the review at
 * that file; while reviewing, the file in view is highlighted.
 */
export function Changes({ task, files }: { task: Task; files: DiffFile[] }) {
  const reviewing = useReview((s) => s.view[task.id] === "review");
  const inView = useReview((s) => s.inView);
  const review = useReview((s) => reviewOf(s, task.id));
  const showFile = useReview((s) => s.showFile);
  const setView = useReview((s) => s.setView);

  return (
    <section aria-label="Changes" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <span className="font-medium">Changes</span>
        <span className="text-muted-foreground tabular-nums">{files.length}</span>
        {files.length > 0 && (
          <>
            <span className="font-mono text-xs tabular-nums">
              <span className="text-diff-add">+{task.changes.additions}</span>{" "}
              <span className="text-diff-del">−{task.changes.deletions}</span>
            </span>
            <button
              type="button"
              aria-pressed={reviewing}
              onClick={() => setView(task.id, reviewing ? "chat" : "review")}
              title={reviewing ? "Back to the chat (Esc)" : "Review the diff (R)"}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                reviewing ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="size-3.5" />
              Review
              {review.comments.length > 0 && <span className="tabular-nums">{review.comments.length}</span>}
            </button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {files.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {task.state === "idle" ? "Changes appear here once the agent starts editing." : "No changes yet."}
          </p>
        ) : (
          <ul>
            {[...files]
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((f) => {
                const [dir, name] = splitPath(f.path);
                const status = STATUS[f.status];
                const viewed = review.viewed.includes(f.path);
                const comments = review.comments.filter((c) => c.path === f.path).length;
                const current = reviewing && inView === f.path;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => showFile(task.id, f.path)}
                      aria-current={current ? "true" : undefined}
                      title={`Review ${f.path}`}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                        current && "bg-accent",
                        viewed && !current && "opacity-60",
                      )}
                    >
                      <span className="grid size-3 shrink-0 place-items-center text-state-review">
                        {viewed && <Check className="size-3" aria-label="Viewed" />}
                      </span>
                      <span className="flex min-w-0 flex-1 font-mono">
                        <span className="truncate text-muted-foreground">{dir}</span>
                        <span className="shrink-0">{name}</span>
                      </span>
                      {comments > 0 && (
                        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                          <MessageSquare className="size-3" />
                          {comments}
                        </span>
                      )}
                      <span className="shrink-0 font-mono tabular-nums">
                        {f.additions > 0 && <span className="text-diff-add">+{f.additions}</span>}{" "}
                        {f.deletions > 0 && <span className="text-diff-del">−{f.deletions}</span>}
                      </span>
                      <span className={cn("w-3 shrink-0 text-center font-mono font-semibold", status.className)} title={status.label}>
                        {status.letter}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </section>
  );
}
