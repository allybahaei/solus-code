"use client";

import { isAttention, type Task } from "@solus/core";
import { StateLabel } from "@/components/state-dot";
import { sidebarSections } from "@/lib/groups";
import { useSolus } from "@/lib/store";

/** Shown when no workspace is open: what needs you, then what's ready. */
export function Home() {
  const tasks = useSolus((s) => s.tasks);
  const pinned = useSolus((s) => s.pinned);
  const open = useSolus((s) => s.open);
  const setNewTaskOpen = useSolus((s) => s.setNewTaskOpen);
  const { pinned: p, workspaces } = sidebarSections(Object.values(tasks), pinned);
  const active = [...p, ...workspaces];
  const needsYou = active.filter((t) => isAttention(t.state));
  const ready = active.filter((t) => t.state === "ready_for_review");
  const working = active.filter((t) => t.state === "working").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold tracking-tight">
          {needsYou.length > 0
            ? `${needsYou.length} ${needsYou.length === 1 ? "workspace needs" : "workspaces need"} you`
            : "Nothing needs you right now"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {working} working · {ready.length} ready for review
        </p>

        <List title="Needs you" tasks={needsYou} onOpen={open} />
        <List title="Ready for review" tasks={ready} onOpen={open} />

        <button
          type="button"
          onClick={() => setNewTaskOpen(true)}
          className="mt-8 text-sm text-muted-foreground hover:text-foreground"
        >
          Start a new task <kbd className="ml-1 font-sans text-xs">N</kbd>
        </button>
      </div>
    </div>
  );
}

function List({ title, tasks, onOpen }: { title: string; tasks: Task[]; onOpen: (id: string) => void }) {
  if (tasks.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs text-muted-foreground">{title}</h2>
      <ul className="divide-y rounded-lg border">
        {tasks.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/60"
            >
              <span className="text-sm font-medium">{t.title}</span>
              <span className="flex min-w-0 items-center gap-2">
                <StateLabel state={t.state} />
                {(t.question ?? t.error?.message) && (
                  <span className="truncate text-xs text-muted-foreground">{t.question ?? t.error?.message}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
