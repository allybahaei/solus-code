"use client";

import { ChevronRight, GitBranch, Plus } from "lucide-react";
import { isAttention, type Task } from "@solus/core";
import { Button } from "@/components/ui/button";
import { StateDot } from "@/components/state-dot";
import { groupTasks } from "@/lib/groups";
import { ago } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { BASE_BRANCH, REPO } from "@/lib/runner";
import { useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const tasks = useSolus((s) => s.tasks);
  const status = useSolus((s) => s.status);
  const showMerged = useSolus((s) => s.showMerged);
  const toggleMerged = useSolus((s) => s.toggleMerged);
  const setNewTaskOpen = useSolus((s) => s.setNewTaskOpen);
  const groups = groupTasks(Object.values(tasks));
  const empty = Object.keys(tasks).length === 0;

  return (
    <nav aria-label="Workspaces" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{REPO}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="size-3" />
            {BASE_BRANCH}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setNewTaskOpen(true)} title="New task (N)">
          <Plus />
          New
          <kbd className="ml-0.5 hidden font-sans text-[10px] text-muted-foreground md:inline">N</kbd>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {status === "connecting" && <p className="px-2 py-3 text-xs text-muted-foreground">Connecting to runner…</p>}
        {status === "ready" && empty && (
          <div className="px-2 py-6 text-sm text-muted-foreground">
            <p>No workspaces yet.</p>
            <p className="mt-1 text-xs">
              Press <kbd className="font-sans font-medium text-foreground">N</kbd> to start a task.
            </p>
          </div>
        )}

        {groups.map(({ group, tasks }) => {
          if (tasks.length === 0) return null;
          const collapsible = group.id === "merged";
          const open = !collapsible || showMerged;
          return (
            <section key={group.id} className="mt-3 first:mt-1">
              <h2
                className={cn(
                  "flex items-center gap-1 px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase",
                  group.id === "attention" && "text-foreground",
                )}
              >
                {collapsible ? (
                  <button
                    type="button"
                    onClick={toggleMerged}
                    aria-expanded={open}
                    className="-ml-1 flex items-center gap-1 rounded px-1 uppercase hover:text-foreground"
                  >
                    <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
                    {group.label}
                  </button>
                ) : (
                  group.label
                )}
                <span className="font-normal tabular-nums">{tasks.length}</span>
              </h2>
              {open && (
                <ul className="space-y-px">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <WorkspaceRow task={t} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

function WorkspaceRow({ task }: { task: Task }) {
  const active = useSolus((s) => s.activeId === task.id);
  const open = useSolus((s) => s.open);
  const now = useNow();
  const attention = isAttention(task.state);
  const detail =
    task.question ??
    task.error?.message ??
    (task.state === "merged"
      ? task.pullRequest
        ? `PR #${task.pullRequest.number}`
        : `Merged into ${task.mergedInto ?? task.baseBranch}`
      : null);

  return (
    <button
      type="button"
      onClick={() => open(task.id)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left text-sm",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        task.state === "needs_input" && "bg-state-needs-input-soft",
        task.state === "stuck" && "bg-state-stuck-soft",
        active && "bg-accent ring-1 ring-border",
        task.state === "merged" && !active && "text-muted-foreground",
      )}
    >
      <StateDot state={task.state} />
      <span className={cn("truncate", attention && "font-medium")}>{task.title}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {now !== null ? ago(now - task.lastActivityAt) : ""}
      </span>
      {(detail || task.changes.files > 0) && (
        <span className="col-start-2 col-end-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {detail ? (
            <span className={cn("truncate", attention && "text-foreground/80")}>{detail}</span>
          ) : (
            <span className="font-mono tabular-nums">
              <span className="text-diff-add">+{task.changes.additions}</span>{" "}
              <span className="text-diff-del">−{task.changes.deletions}</span>
            </span>
          )}
        </span>
      )}
    </button>
  );
}
