"use client";

import { memo, useMemo, useState } from "react";
import { DiffModeEnum, DiffView, SplitSide } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { ChevronRight, MessageSquare } from "lucide-react";
import type { DiffFile } from "@solus/core";
import { CommentForm } from "@/components/review/comment-form";
import { Button } from "@/components/ui/button";
import { splitPath } from "@/lib/format";
import { reviewOf, useReview, type DiffSide, type ReviewComment } from "@/lib/review-store";
import { cn } from "@/lib/utils";

const STATUS: Record<DiffFile["status"], { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-diff-add", label: "Added" },
  modified: { letter: "M", className: "text-state-needs-input", label: "Modified" },
  deleted: { letter: "D", className: "text-diff-del", label: "Deleted" },
  renamed: { letter: "R", className: "text-state-working", label: "Renamed" },
};

const toSide = (s: SplitSide): DiffSide => (s === SplitSide.old ? "old" : "new");

/** One file in the review: a sticky header and its diff with line comments. */
export const FileDiff = memo(function FileDiff({
  taskId,
  file,
  mode,
  canComment,
}: {
  taskId: string;
  file: DiffFile;
  mode: "unified" | "split";
  canComment: boolean;
}) {
  const viewed = useReview((s) => reviewOf(s, taskId).viewed.includes(file.path));
  const allComments = useReview((s) => reviewOf(s, taskId).comments);
  const toggleViewed = useReview((s) => s.toggleViewed);
  const addComment = useReview((s) => s.addComment);
  const [open, setOpen] = useState(!viewed);
  const comments = useMemo(() => allComments.filter((c) => c.path === file.path), [allComments, file.path]);
  const [dir, name] = splitPath(file.path);
  const status = STATUS[file.status];

  const extendData = useMemo(() => {
    const bySide = { oldFile: {} as Record<string, { data: ReviewComment[] }>, newFile: {} as Record<string, { data: ReviewComment[] }> };
    for (const c of comments) {
      const target = c.side === "old" ? bySide.oldFile : bySide.newFile;
      (target[c.line] ??= { data: [] }).data.push(c);
    }
    return bySide;
  }, [comments]);

  return (
    <section data-path={file.path} className="scroll-mt-2 border-b last:border-b-0">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${file.path}` : `Expand ${file.path}`}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <span className={cn("w-3 shrink-0 text-center font-mono font-semibold", status.className)} title={status.label}>
          {status.letter}
        </span>
        <span className="flex min-w-0 flex-1 font-mono" title={file.path}>
          {file.oldPath && <span className="truncate text-muted-foreground">{file.oldPath} → </span>}
          <span className="truncate text-muted-foreground">{dir}</span>
          <span className="shrink-0 text-foreground">{name}</span>
        </span>
        {comments.length > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground" title={`${comments.length} comments`}>
            <MessageSquare className="size-3.5" />
            {comments.length}
          </span>
        )}
        <span className="shrink-0 font-mono tabular-nums">
          {file.additions > 0 && <span className="text-diff-add">+{file.additions}</span>}{" "}
          {file.deletions > 0 && <span className="text-diff-del">−{file.deletions}</span>}
        </span>
        <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-muted-foreground select-none hover:text-foreground">
          <input
            type="checkbox"
            checked={viewed}
            onChange={() => {
              toggleViewed(taskId, file.path);
              setOpen(viewed); // ticking collapses, unticking expands
            }}
            className="size-3.5 accent-[var(--state-review)]"
          />
          Viewed
        </label>
      </header>
      {open && (
        <div className="solus-diff overflow-x-auto">
          <DiffView<ReviewComment[]>
            data={{
              oldFile: { fileName: file.oldPath ?? file.path },
              newFile: { fileName: file.path },
              hunks: [file.patch],
            }}
            diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
            diffViewTheme="dark"
            diffViewHighlight
            diffViewFontSize={12}
            diffViewAddWidget={canComment}
            extendData={extendData}
            renderWidgetLine={({ side, lineNumber, onClose }) => (
              <CommentForm
                submitLabel="Add comment"
                onCancel={onClose}
                onSubmit={(text) => {
                  addComment(taskId, { path: file.path, side: toSide(side), line: lineNumber, text });
                  onClose();
                }}
              />
            )}
            renderExtendLine={({ data }) => <CommentThread taskId={taskId} comments={data} canEdit={canComment} />}
          />
        </div>
      )}
    </section>
  );
});

function CommentThread({ taskId, comments, canEdit }: { taskId: string; comments: ReviewComment[]; canEdit: boolean }) {
  const updateComment = useReview((s) => s.updateComment);
  const deleteComment = useReview((s) => s.deleteComment);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-px border-y bg-card font-sans">
      {comments.map((c) =>
        editing === c.id ? (
          <CommentForm
            key={c.id}
            initial={c.text}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onSubmit={(text) => {
              updateComment(taskId, c.id, text);
              setEditing(null);
            }}
          />
        ) : (
          <div key={c.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
            <span className="mt-0.5 rounded bg-state-needs-input/15 px-1.5 py-px text-[10px] font-medium tracking-wide text-state-needs-input uppercase">
              Draft
            </span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap">{c.text}</p>
            {canEdit && (
              <span className="flex shrink-0 gap-1">
                <Button size="xs" variant="ghost" onClick={() => setEditing(c.id)}>
                  Edit
                </Button>
                <Button size="xs" variant="ghost" onClick={() => deleteComment(taskId, c.id)}>
                  Delete
                </Button>
              </span>
            )}
          </div>
        ),
      )}
    </div>
  );
}
