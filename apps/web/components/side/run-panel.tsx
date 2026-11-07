"use client";

import { useState } from "react";
import { Maximize2, Minimize2, ArrowUpRight, Play, Square } from "lucide-react";
import type { Task } from "@solus/core";
import { TerminalView } from "@/components/side/terminal";
import { Button } from "@/components/ui/button";
import { startAction, stopAction } from "@/lib/actions";
import { useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Run and Terminal, side by side in tabs. */
export function BottomPane({ task }: { task: Task }) {
  const [tab, setTab] = useState<"run" | "terminal">("terminal");
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Workspace tools" className="flex h-10 shrink-0 items-stretch gap-1 border-b px-2">
        {(["run", "terminal"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "relative px-2 text-sm capitalize",
              tab === t ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "run" && task.running && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-state-review" aria-label="Running" />
            )}
            {tab === t && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-foreground" />}
          </button>
        ))}
        <BigToggle />
      </div>
      {tab === "run" ? <RunPanel task={task} /> : <TerminalView task={task} />}
    </section>
  );
}

function BigToggle() {
  const big = useSolus((s) => s.terminalBig);
  const toggle = useSolus((s) => s.toggleTerminalBig);
  const label = big ? "Shrink the terminal (T)" : "Give the terminal the whole window (T)";
  return (
    <button type="button" onClick={toggle} aria-pressed={big} aria-label={label} title={label} className="my-auto ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
      {big ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    </button>
  );
}

/** Saved commands from solus.json, running in this task's worktree on its own port. */
export function RunPanel({ task }: { task: Task }) {
  const actions = useSolus((s) => s.repo?.actions) ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen ?? actions[0] ?? "";
  const hasWorkspace = task.state !== "idle";

  if (actions.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        <p>No saved commands yet. Add them to solus.json in your repo:</p>
        <code className="mt-2 block font-mono break-all text-foreground">
          {'{ "run": "pnpm dev --port $SOLUS_PORT" }'}
        </code>
        <p className="mt-2">Each task gets its own ports, so several can run at once.</p>
      </div>
    );
  }

  return (
    <section aria-label="Run" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        {actions.length > 1 && (
          <select
            value={selected}
            onChange={(e) => setChosen(e.target.value)}
            aria-label="Saved command"
            className="h-7 min-w-0 rounded-md border bg-transparent px-1.5 text-xs"
          >
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        )}
        {task.running ? (
          <Button size="sm" variant="outline" onClick={() => stopAction(task.id)}>
            <Square />
            Stop {task.running}
          </Button>
        ) : (
          <Button size="sm" disabled={!hasWorkspace} onClick={() => startAction(task.id, selected)}>
            <Play />
            Run {actions.length === 1 ? selected : ""}
          </Button>
        )}
        {task.running && task.port && (
          <a
            href={`http://localhost:${task.port}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            :{task.port}
            <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>
      <TerminalView key={`${task.id}-run`} task={task} source="run" />
    </section>
  );
}
