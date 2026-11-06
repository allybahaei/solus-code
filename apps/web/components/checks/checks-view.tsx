"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, CircleDashed, GitMerge, Loader2, MessageSquare, Minus, RefreshCw, Upload, X } from "lucide-react";
import type { MergeStrategy, PullRequestCheck, PullRequestComment, PullRequestStatus, Task } from "@solus/core";
import { Button } from "@/components/ui/button";
import { fixCheck, fixComment, mergePullRequest, pushPullRequest, readPullRequest } from "@/lib/actions";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;

const CHECK_ICON: Record<PullRequestCheck["state"], { icon: typeof Check; className: string; label: string }> = {
  passed: { icon: Check, className: "text-state-review", label: "Passed" },
  failed: { icon: X, className: "text-state-stuck", label: "Failed" },
  pending: { icon: CircleDashed, className: "text-state-working", label: "Running" },
  skipped: { icon: Minus, className: "text-muted-foreground", label: "Skipped" },
};

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

const STRATEGIES: readonly (readonly [MergeStrategy, string])[] = [
  ["squash", "Squash"],
  ["merge", "Merge commit"],
  ["rebase", "Rebase"],
];

/** The task's pull request: CI, review comments, and merging it. */
export function ChecksView({ task }: { task: Task }) {
  const pr = task.pullRequest;
  const [status, setStatus] = useState<PullRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] = useState<MergeStrategy>("squash");

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await readPullRequest(task.id);
    if (typeof result === "string") setError(result);
    else {
      setStatus(result);
      setError(null);
    }
    setLoading(false);
  }, [task.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read, then a timer
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!pr) return null;

  const ready = task.state === "ready_for_review";
  const open = status?.state === "open";
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await work();
    setBusy(false);
    await refresh();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-4">
        <header className="flex flex-wrap items-center gap-3 text-sm">
          <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
            Pull request #{pr.number}
            <ArrowUpRight className="size-3.5" />
          </a>
          {status && (
            <span className="text-xs text-muted-foreground capitalize">
              {status.state}
              {status.reviewDecision && ` · ${REVIEW_LABEL[status.reviewDecision] ?? status.reviewDecision}`}
            </span>
          )}
          <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => void refresh()} disabled={loading} aria-label="Refresh" title="Refresh">
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </header>

        {error && (
          <p role="alert" className="rounded-md bg-state-stuck-soft px-3 py-2 text-sm text-state-stuck">
            Couldn&apos;t read this pull request: {error}
          </p>
        )}
        {!status && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </p>
        )}

        {status && (
          <>
            <section aria-label="Checks">
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">Checks</h2>
              {status.checks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No checks have reported on this pull request.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {status.checks.map((c) => (
                    <CheckRow key={`${c.name}-${c.url ?? ""}`} check={c} canFix={ready && open} onFix={() => void act(() => fixCheck(task.id, pr.number, c))} />
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Review comments">
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">Comments</h2>
              {status.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                <ul className="space-y-2">
                  {status.comments.map((c) => (
                    <CommentRow key={c.id} comment={c} canFix={ready && open} onFix={() => void act(() => fixComment(task.id, pr.number, c))} />
                  ))}
                </ul>
              )}
            </section>

            {open && (
              <section aria-label="Update and merge" className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button size="sm" variant="outline" disabled={!ready || busy} onClick={() => void act(() => pushPullRequest(task.id))} title="Commit and push this task's work to the pull request">
                  <Upload />
                  Push changes
                </Button>
                <span className="ml-auto" />
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  aria-label="Merge method"
                  className="h-8 rounded-md border bg-transparent px-2 text-xs"
                >
                  {STRATEGIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!ready || busy || status.conflicts}
                  onClick={() => void act(() => mergePullRequest(task.id, strategy))}
                  title={status.conflicts ? "This pull request has conflicts with its base branch" : "Pushes any new work, then merges on GitHub"}
                  className="bg-state-review text-black hover:bg-state-review/85"
                >
                  <GitMerge />
                  Merge pull request
                </Button>
                {status.conflicts && <p className="w-full text-xs text-state-stuck">This pull request has conflicts with its base branch.</p>}
                {!ready && <p className="w-full text-xs text-muted-foreground">Available once the agent has finished.</p>}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CheckRow({ check, canFix, onFix }: { check: PullRequestCheck; canFix: boolean; onFix: () => void }) {
  const { icon: Icon, className, label } = CHECK_ICON[check.state];
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <Icon className={cn("size-4 shrink-0", className)} aria-label={label} />
      <span className="min-w-0 flex-1 truncate">
        {check.url ? (
          <a href={check.url} target="_blank" rel="noreferrer" className="hover:underline">
            {check.name}
          </a>
        ) : (
          check.name
        )}
      </span>
      {check.state === "failed" && canFix && (
        <Button size="xs" variant="outline" onClick={onFix}>
          Fix this
        </Button>
      )}
    </li>
  );
}

function CommentRow({ comment, canFix, onFix }: { comment: PullRequestComment; canFix: boolean; onFix: () => void }) {
  return (
    <li className="rounded-md border px-3 py-2 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="size-3 shrink-0" />
        <span className="font-medium text-foreground">{comment.author}</span>
        {comment.path && (
          <span className="min-w-0 truncate font-mono">
            {comment.path}
            {comment.line ? `:${comment.line}` : ""}
          </span>
        )}
        {canFix && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onFix}>
            Fix this
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap">{comment.body}</p>
    </li>
  );
}
