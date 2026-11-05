"use client";

import { ArrowUpRight, GitBranch, GitMerge, GitPullRequest, MessageSquare, Play, Square } from "lucide-react";
import type { Task } from "@solus/core";
import { AGENTS, AgentIcon } from "@/components/agent-picker";
import { StateLabel } from "@/components/state-dot";
import { Button } from "@/components/ui/button";
import { startTask, stopTask } from "@/lib/actions";
import { reviewOf, useReview } from "@/lib/review-store";
import { displayTitle, useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Title, branch, state, the Chat/Review switch, and the action that moves the task forward. */
export function TaskHeader({ task }: { task: Task }) {
  const { changes } = task;
  const title = useSolus((s) => displayTitle(s, task));
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <StateLabel state={task.state} />
          <span className="inline-flex items-center gap-1.5">
            <AgentIcon agent={task.agent} className="size-3.5" />
            {AGENTS[task.agent].label}
          </span>
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranch className="size-3" />
            {task.branch}
          </span>
          {changes.files > 0 && (
            <span className="font-mono tabular-nums">
              {changes.files} {changes.files === 1 ? "file" : "files"}{" "}
              <span className="text-diff-add">+{changes.additions}</span>{" "}
              <span className="text-diff-del">−{changes.deletions}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ViewSwitch task={task} />
        <Actions task={task} />
      </div>
    </header>
  );
}

/** Chat | Review, on wide screens. Narrow screens use the Chat/Changes/Terminal tabs. */
function ViewSwitch({ task }: { task: Task }) {
  const view = useReview((s) => s.view[task.id] ?? "chat");
  const setView = useReview((s) => s.setView);
  const comments = useReview((s) => reviewOf(s, task.id).comments.length);
  if (task.changes.files === 0) return null;
  return (
    <div role="tablist" aria-label="View" className="hidden rounded-md border p-0.5 text-xs lg:flex">
      {(["chat", "review"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => setView(task.id, v)}
          title={v === "review" ? "Review the diff (R)" : "Back to the chat (Esc)"}
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

function Actions({ task }: { task: Task }) {
  const openMerge = useReview((s) => s.openMerge);
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
        <Button size="sm" variant="outline" onClick={() => stopTask(task.id)} title="Stop the agent">
          <Square />
          Stop
        </Button>
      );
    case "ready_for_review":
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
      ) : (
        <span className="text-xs text-muted-foreground">Merged into {task.mergedInto ?? task.baseBranch}</span>
      );
    default:
      return null;
  }
}
