"use client";

import { useEffect, useState } from "react";
import { STATE_LABELS, compareTasks, isAttention, type Task, type TaskState } from "@solus/core";
import { createMockRunner } from "@solus/runner-mock";
import { cn } from "@/lib/utils";

interface Row {
  task: Task;
  /** Latest line of agent output, appended to while it streams. */
  lastLine: string;
  messageId?: string;
}

const STATE_DOT: Record<TaskState, string> = {
  idle: "bg-state-idle",
  working: "bg-state-working animate-pulse",
  needs_input: "bg-state-needs-input",
  stuck: "bg-state-stuck",
  ready_for_review: "bg-state-review",
  merged: "bg-state-merged",
};

const STATE_ROW: Partial<Record<TaskState, string>> = {
  needs_input: "bg-state-needs-input-soft",
  stuck: "bg-state-stuck-soft",
};

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    queueMicrotask(tick);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function RunnerDebug() {
  const [rows, setRows] = useState<Map<string, Row> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    const runner = createMockRunner({ autopilot: true });
    const update = (id: string, fn: (row: Row) => Row) =>
      setRows((prev) => {
        const row = prev?.get(id);
        if (!prev || !row) return prev;
        return new Map(prev).set(id, fn(row));
      });

    const unsubscribe = runner.subscribe((e) => {
      switch (e.type) {
        case "task.created":
          setRows((prev) => new Map(prev).set(e.taskId, { task: e.task, lastLine: "" }));
          break;
        case "task.state_changed":
          update(e.taskId, (r) => ({ ...r, task: e.task }));
          break;
        case "agent.output":
          update(e.taskId, (r) => ({
            task: { ...r.task, lastActivityAt: e.at },
            messageId: e.messageId,
            lastLine:
              e.messageId === r.messageId
                ? r.lastLine + e.chunk
                : e.tool
                  ? `${e.tool} ${e.chunk}`
                  : e.chunk,
          }));
          break;
        case "diff.updated":
          update(e.taskId, (r) => ({ ...r, task: { ...r.task, changes: e.changes, lastActivityAt: e.at } }));
          break;
        case "error":
          setError(e.message);
          break;
      }
    });

    runner
      .listTasks()
      .then(async (tasks) => {
        const entries = await Promise.all(
          tasks.map(async (task) => {
            const messages = await runner.getMessages(task.id);
            const last = messages.at(-1);
            const lastLine = last ? (last.tool ? `${last.tool} ${last.text}` : last.text) : "";
            return [task.id, { task, lastLine }] as const;
          }),
        );
        setRows(new Map(entries));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

    return () => {
      unsubscribe();
      runner.dispose();
    };
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">Runner error: {error}</p>;
  }
  if (!rows || now === null) {
    return <p className="text-sm text-muted-foreground">Connecting to runner…</p>;
  }
  if (rows.size === 0) {
    return <p className="text-sm text-muted-foreground">No tasks.</p>;
  }

  const sorted = [...rows.values()].sort((a, b) => compareTasks(a.task, b.task));

  return (
    <ul className="divide-y rounded-lg border">
      {sorted.map(({ task, lastLine }) => (
        <li key={task.id} className={cn("grid gap-1 px-4 py-3", STATE_ROW[task.state])}>
          <div className="flex items-center gap-3">
            <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[task.state])} aria-hidden />
            <span className={cn("truncate text-sm", isAttention(task.state) ? "font-medium" : "")}>{task.title}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {ago(now - task.lastActivityAt)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-xs text-muted-foreground">
            <span className={cn(isAttention(task.state) && "font-medium text-foreground")}>
              {STATE_LABELS[task.state]}
            </span>
            <span className="font-mono">{task.branch}</span>
            {task.changes.files > 0 && (
              <span className="font-mono tabular-nums">
                {task.changes.files} files <span className="text-diff-add">+{task.changes.additions}</span>{" "}
                <span className="text-diff-del">−{task.changes.deletions}</span>
              </span>
            )}
            {task.pullRequest && <span className="font-mono">PR #{task.pullRequest.number}</span>}
          </div>
          <p className="truncate pl-5 text-xs text-muted-foreground">
            {task.question ?? task.error?.message ?? lastLine}
          </p>
        </li>
      ))}
    </ul>
  );
}
