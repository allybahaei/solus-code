"use client";

import { useState } from "react";
import { AlertTriangle, GitBranch, GitMerge, GitPullRequest } from "lucide-react";
import type { MergeStrategy, Task } from "@solus/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { mergeTask, openPullRequest, resolveConflicts } from "@/lib/actions";
import { stripLocalLinks } from "@/lib/review-message";
import { reviewOf, rememberMergeMode, useReview, type MergeMode } from "@/lib/review-store";
import { displayTitle, useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

/** The agent's last message: its own summary of the work, which makes a good PR body. */
function agentSummary(taskId: string): string {
  const messages = useSolus.getState().messages[taskId] ?? [];
  return stripLocalLinks([...messages].reverse().find((m) => m.role === "agent")?.text.trim() ?? "");
}

export function MergeDialog() {
  const merge = useReview((s) => s.merge);
  const closeMerge = useReview((s) => s.closeMerge);
  const task = useSolus((s) => (merge ? s.tasks[merge.taskId] : undefined));

  return (
    <Dialog open={!!merge && !!task} onOpenChange={(open) => !open && closeMerge()}>
      <DialogContent className="sm:max-w-xl">
        {/* Keyed so the form re-fills from the task each time it opens. */}
        {merge && task && <MergeForm key={`${task.id}-${merge.mode}`} task={task} initialMode={merge.mode} onDone={closeMerge} />}
      </DialogContent>
    </Dialog>
  );
}

function MergeForm({ task, initialMode, onDone }: { task: Task; initialMode: MergeMode; onDone: () => void }) {
  const title = useSolus((s) => displayTitle(s, task));
  const unsent = useReview((s) => reviewOf(s, task.id).comments.length);
  const [mode, setMode] = useState<MergeMode>(initialMode);
  const [target, setTarget] = useState(task.baseBranch);
  const [prTitle, setPrTitle] = useState(title);
  const [body, setBody] = useState(() => {
    const summary = agentSummary(task.id);
    return summary ? `${task.prompt}\n\n## What changed\n\n${summary}` : task.prompt;
  });
  const [commitMessage, setCommitMessage] = useState(() => {
    const summary = agentSummary(task.id);
    return summary ? `${title}\n\n${summary}` : title;
  });
  const [strategy, setStrategy] = useState<MergeStrategy>("squash");
  const [draft, setDraft] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = target.trim() && (mode === "pr" ? prTitle.trim() : commitMessage.trim());

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    rememberMergeMode(mode);
    const err =
      mode === "pr"
        ? await openPullRequest(task.id, { title: prTitle.trim(), body: body.trim(), baseBranch: target.trim(), draft })
        : await mergeTask(task.id, {
            targetBranch: target.trim(),
            commitMessage: commitMessage.trim(),
            strategy,
            deleteBranch,
          });
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle className="truncate pr-6">Merge “{title}”</DialogTitle>
        <DialogDescription className="flex items-center gap-1.5 font-mono text-xs">
          <GitBranch className="size-3" />
          {task.branch}
          <span className="font-sans">·</span>
          <span className="font-sans tabular-nums">
            {task.changes.files} files <span className="text-diff-add">+{task.changes.additions}</span>{" "}
            <span className="text-diff-del">−{task.changes.deletions}</span>
          </span>
        </DialogDescription>
      </DialogHeader>

      <div role="radiogroup" aria-label="How to merge" className="grid grid-cols-2 gap-1 rounded-lg border p-1 text-sm">
        {(
          [
            ["pr", "Open pull request", GitPullRequest],
            ["merge", "Merge locally", GitMerge],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md py-1.5",
              mode === m ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <Field label="Into">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Target branch"
          className="h-8 w-full rounded-md border bg-transparent px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      {mode === "pr" ? (
        <>
          <Field label="Title">
            <input
              autoFocus
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              aria-label="Pull request title"
              className="h-8 w-full rounded-md border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <Field label="Body">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} aria-label="Pull request body" className="max-h-64 text-sm" />
          </Field>
          <Check checked={draft} onChange={setDraft} label="Open as a draft" />
        </>
      ) : (
        <>
          <Field label="Strategy">
            <div role="radiogroup" aria-label="Merge strategy" className="flex gap-1 text-sm">
              {(["squash", "merge", "rebase"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={strategy === s}
                  onClick={() => setStrategy(s)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 capitalize",
                    strategy === s ? "border-foreground/30 bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Message">
            <Textarea
              autoFocus
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={6}
              aria-label="Commit message"
              className="max-h-64 font-mono text-xs"
            />
          </Field>
          <Check checked={deleteBranch} onChange={setDeleteBranch} label="Delete the branch and worktree afterwards" />
        </>
      )}

      {unsent > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-state-needs-input-soft px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-state-needs-input" />
          You have {unsent} unsent review {unsent === 1 ? "comment" : "comments"}. They won&apos;t be sent if you merge now.
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-md bg-state-stuck-soft px-3 py-2 text-sm text-state-stuck">
          {error}
          {error.startsWith("Can't merge:") && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 flex text-foreground"
              onClick={() => {
                void resolveConflicts(task.id, target.trim());
                onDone();
              }}
            >
              Ask the agent to resolve it
            </Button>
          )}
        </div>
      )}

      <DialogFooter className="flex-row items-center sm:justify-between">
        <span className="hidden text-xs text-muted-foreground sm:inline">⌘Enter to confirm</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || busy} className="bg-state-review text-black hover:bg-state-review/85">
            {mode === "pr" ? "Create pull request" : strategy === "squash" ? "Squash and merge" : strategy === "rebase" ? "Rebase and merge" : "Merge"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-3">
      <span className="pt-1.5 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="ml-[5.25rem] flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none hover:text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--state-review)]"
      />
      {label}
    </label>
  );
}
