"use client";

import { useState } from "react";
import { ArrowUpRight, GitMerge, GitPullRequest, ListChecks, MessageSquare, Play, Square, Trash2 } from "lucide-react";
import type { Task, TaskState } from "@solus/core";
import { StateLabel } from "@/components/state-dot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteTask, startTask, stopTask } from "@/lib/actions";
import { reviewOf, useReview } from "@/lib/review-store";
import { activeChatId, taskInChat, useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Soft fills, so the bar reads at a glance. Other states stay plain. */
const TINT: Partial<Record<TaskState, string>> = {
  needs_input: "bg-state-needs-input-soft",
  stuck: "bg-state-stuck-soft",
  ready_for_review: "bg-state-review/10",
};

/** The task's state and the action that moves it forward. Sits above the changes, or above the chat without them. */
export function TaskBar({ task, showSwitch = false }: { task: Task; showSwitch?: boolean }) {
  const label =
    task.state === "merged"
      ? `Merged into ${task.mergedInto ?? task.baseBranch}`
      : task.pullRequest && task.state === "ready_for_review"
        ? "PR opened"
        : undefined;
  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b px-3", TINT[task.state])}>
      <div className="min-w-0 flex-1 overflow-hidden">
        <StateLabel state={task.state} {...(label ? { label } : {})} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showSwitch ? <ViewSwitch task={task} /> : task.pullRequest && <ChecksToggle task={task} />}
        <Actions task={task} />
      </div>
    </header>
  );
}

/** The switch isn't here while the changes pane is, so Checks needs its own way in. */
function ChecksToggle({ task }: { task: Task }) {
  const checking = useReview((s) => s.view[task.id] === "checks");
  const setView = useReview((s) => s.setView);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={checking}
      onClick={() => setView(task.id, checking ? "chat" : "checks")}
      title={checking ? "Back to the chat" : "CI and review comments"}
    >
      <ListChecks />
      Checks
    </Button>
  );
}

/** Chat | Review, on wide screens. Narrow screens use the Chat/Changes/Terminal tabs. */
function ViewSwitch({ task }: { task: Task }) {
  const view = useReview((s) => s.view[task.id] ?? "chat");
  const setView = useReview((s) => s.setView);
  const comments = useReview((s) => reviewOf(s, task.id).comments.length);
  if (task.changes.files === 0 && !task.pullRequest) return null;
  const views = task.pullRequest ? (["chat", "review", "checks"] as const) : (["chat", "review"] as const);
  return (
    <div role="tablist" aria-label="View" className="hidden rounded-md border p-0.5 text-xs lg:flex">
      {views.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => setView(task.id, v)}
          title={v === "review" ? "Review the diff (R)" : v === "checks" ? "CI and review comments" : "Back to the chat (Esc)"}
          className={cn(
            "rounded px-2.5 py-1 capitalize",
            view === v ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v}
          {v === "review" && (
            <span className="ml-1 inline-flex items-center gap-1 tabular-nums opacity-70">
              {task.changes.files}
              {comments > 0 && (
                <>
                  <span>·</span>
                  <MessageSquare className="size-3" />
                  {comments}
                </>
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Deleting can't be undone, so it says what will go, in terms of this task. */
export function DeleteTask({ task, className }: { task: Task; className?: string }) {
  const [open, setOpen] = useState(false);
  const landed = task.state === "merged" || !!task.pullRequest;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label="Delete task" title="Delete task">
        <Trash2 />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
            <DialogDescription>
              {landed
                ? `This removes the task and its local branch ${task.branch}. Merged work and any open pull request stay as they are.`
                : `This stops the agent and permanently removes ${task.branch}, its worktree and the conversation. Any work on it that hasn't been merged will be lost.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                void deleteTask(task.id);
              }}
            >
              Delete task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Actions({ task }: { task: Task }) {
  const openMerge = useReview((s) => s.openMerge);
  const chatId = useSolus((s) => activeChatId(s, task));
  const inChat = taskInChat(task, chatId);
  if (task.archivedAt) return null;
  switch (task.state) {
    case "idle":
      return (
        <Button size="sm" onClick={() => startTask(task.id)} title="Start (S)">
          <Play />
          Start
        </Button>
      );
    case "working":
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => stopTask(task.id, inChat.state === "working" ? chatId : undefined)}
          title={inChat.state === "working" ? "Stop this chat's agent" : "Stop every running chat"}
        >
          <Square />
          Stop
        </Button>
      );
    case "ready_for_review":
      if (task.pullRequest) {
        return (
          <Button size="sm" variant="ghost" asChild>
            <a href={task.pullRequest.url} target="_blank" rel="noreferrer">
              PR #{task.pullRequest.number}
              <ArrowUpRight />
            </a>
          </Button>
        );
      }
      return (
        <>
          <Button size="sm" variant="outline" onClick={() => openMerge(task.id, "pr")} title="Open a pull request (P)">
            <GitPullRequest />
            Open PR
          </Button>
          <Button
            size="sm"
            onClick={() => openMerge(task.id, "merge")}
            title={`Merge into ${task.baseBranch} (M)`}
            className="bg-state-review text-black hover:bg-state-review/85"
          >
            <GitMerge />
            Merge
          </Button>
        </>
      );
    case "merged":
      return task.pullRequest ? (
        <Button size="sm" variant="ghost" asChild>
          <a href={task.pullRequest.url} target="_blank" rel="noreferrer">
            PR #{task.pullRequest.number}
            <ArrowUpRight />
          </a>
        </Button>
      ) : null;
    default:
      return null;
  }
}
