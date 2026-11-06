"use client";

import { useEffect, useRef } from "react";
import { GitMerge, Info } from "lucide-react";
import type { DiffFile, Task } from "@solus/core";
import { FileDiff } from "@/components/review/file-diff";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendMessage } from "@/lib/actions";
import { formatReview } from "@/lib/review-message";
import { reviewOf, useReview } from "@/lib/review-store";
import { useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

export const REVIEW_SUMMARY_ID = "review-summary";

export function sortFiles(files: DiffFile[]): DiffFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

/** Sends the drafts and summary to the agent, then goes back to the chat. */
export function requestChanges(task: Task) {
  // Comments are cleared after sending, so don't try while offline.
  if (!useSolus.getState().connected) return;
  const files = useSolus.getState().diffs[task.id] ?? [];
  const review = reviewOf(useReview.getState(), task.id);
  const message = formatReview(files, review.comments, review.summary);
  if (!message) return;
  void sendMessage(task.id, message);
  useReview.getState().clearReview(task.id);
  useReview.getState().setView(task.id, "chat");
}

/** The task's diff, file by file, with line comments and the review actions. */
export function ReviewView({ task, files, narrow }: { task: Task; files: DiffFile[]; narrow: boolean }) {
  const diffMode = useReview((s) => s.diffMode);
  const setDiffMode = useReview((s) => s.setDiffMode);
  const review = useReview((s) => reviewOf(s, task.id));
  const setView = useReview((s) => s.setView);
  const setInView = useReview((s) => s.setInView);
  const scrollTarget = useReview((s) => s.scrollTarget);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = sortFiles(files);
  const viewedCount = sorted.filter((f) => review.viewed.includes(f.path)).length;
  const merged = task.state === "merged";
  const mode = narrow ? "unified" : diffMode;
  const firstPath = sorted[0]?.path ?? null;

  // Jump to a file picked in the changes list.
  useEffect(() => {
    if (!scrollTarget || scrollTarget.taskId !== task.id) return;
    const el = scrollRef.current?.querySelector(`[data-path="${CSS.escape(scrollTarget.path)}"]`);
    el?.scrollIntoView({ block: "start" });
  }, [scrollTarget, task.id]);

  // Track which file is at the top, for the changes list and J/K.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const update = () => {
      const top = root.getBoundingClientRect().top;
      let current: string | null = null;
      for (const el of root.querySelectorAll<HTMLElement>("section[data-path]")) {
        if (el.getBoundingClientRect().top - top <= 8) current = el.dataset.path ?? null;
        else break;
      }
      setInView(current ?? firstPath);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    return () => root.removeEventListener("scroll", update);
  }, [setInView, firstPath, task.id]);

  if (files.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        <p>No changes yet.</p>
        <Button size="sm" variant="outline" onClick={() => setView(task.id, "chat")}>
          Back to chat
        </Button>
      </div>
    );
  }

  const banner =
    task.state === "merged"
      ? task.pullRequest
        ? `Pull request #${task.pullRequest.number} is open on GitHub. This review is read-only.`
        : `Merged into ${task.mergedInto ?? task.baseBranch}. This review is read-only.`
      : task.state === "working" || task.state === "needs_input" || task.state === "stuck"
        ? "The agent is still working, so this diff may change. Your draft comments are kept."
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {viewedCount} of {sorted.length} viewed
        </span>
        {!narrow && (
          <div role="radiogroup" aria-label="Diff layout" className="ml-auto flex rounded-md border p-0.5">
            {(["unified", "split"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={diffMode === m}
                onClick={() => setDiffMode(m)}
                className={cn(
                  "rounded px-2 py-0.5 capitalize",
                  diffMode === m ? "bg-accent text-foreground" : "hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {banner && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {banner}
        </div>
      )}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {sorted.map((f) => (
          <FileDiff key={f.path} taskId={task.id} file={f} mode={mode} canComment={!merged} />
        ))}
      </div>

      {!merged && <ReviewBar task={task} commentCount={review.comments.length} summary={review.summary} />}
    </div>
  );
}

function ReviewBar({ task, commentCount, summary }: { task: Task; commentCount: number; summary: string }) {
  const setSummary = useReview((s) => s.setSummary);
  const openMerge = useReview((s) => s.openMerge);
  const connected = useSolus((s) => s.connected);
  const canSend = connected && (commentCount > 0 || summary.trim().length > 0);
  const ready = task.state === "ready_for_review";

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      <Textarea
        id={REVIEW_SUMMARY_ID}
        value={summary}
        onChange={(e) => setSummary(task.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            requestChanges(task);
          }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        placeholder="Overall comment (optional)…"
        rows={2}
        className="min-h-14 resize-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {commentCount === 0 ? "No comments yet. Hover a line and click + to add one." : `${commentCount} draft ${commentCount === 1 ? "comment" : "comments"}`}
        </span>
        <Button size="sm" variant="outline" disabled={!canSend} onClick={() => requestChanges(task)} title="Send to the agent (⌘Enter)">
          Request changes
        </Button>
        {ready && (
          <Button
            size="sm"
            onClick={() => openMerge(task.id)}
            className="bg-state-review text-black hover:bg-state-review/85"
            title="Merge or open a pull request (M)"
          >
            <GitMerge />
            Merge…
          </Button>
        )}
      </div>
    </div>
  );
}
