"use client";

import { ArrowUpRight, GitBranch, GitMerge, GitPullRequest, Play, Square } from "lucide-react";
import type { Task } from "@solus/core";
import { AGENTS, AgentIcon } from "@/components/agent-picker";
import { StateLabel } from "@/components/state-dot";
import { Button } from "@/components/ui/button";
import { displayTitle, useSolus } from "@/lib/store";
import { mergeTask, openPullRequest, startTask, stopTask } from "@/lib/actions";

/** Title, branch, state, and the one action that moves the task forward. */
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
        <Actions task={task} />
      </div>
    </header>
  );
}

function Actions({ task }: { task: Task }) {
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
          <Button size="sm" variant="outline" onClick={() => openPullRequest(task.id)} title="Open a pull request (P)">
            <GitPullRequest />
            Open PR
          </Button>
          <Button size="sm" onClick={() => mergeTask(task.id)} title={`Squash-merge into ${task.baseBranch} (M)`}>
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
