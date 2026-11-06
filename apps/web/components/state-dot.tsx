import { STATE_LABELS, type TaskState } from "@solus/core";
import { cn } from "@/lib/utils";

const DOT: Record<TaskState, string> = {
  idle: "border border-state-idle",
  working: "bg-state-working animate-pulse",
  needs_input: "bg-state-needs-input ring-3 ring-state-needs-input/25",
  stuck: "bg-state-stuck ring-3 ring-state-stuck/25",
  ready_for_review: "bg-state-review",
  merged: "bg-state-merged",
};

export function StateDot({ state, className }: { state: TaskState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATE_LABELS[state]}
      className={cn("inline-block size-2 shrink-0 rounded-full", DOT[state], className)}
    />
  );
}

const TEXT: Record<TaskState, string> = {
  idle: "text-muted-foreground",
  working: "text-state-working",
  needs_input: "text-state-needs-input",
  stuck: "text-state-stuck",
  ready_for_review: "text-state-review",
  merged: "text-state-merged",
};

/** Dot + label, for headers. `label` overrides the state's name. */
export function StateLabel({ state, label }: { state: TaskState; label?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap", TEXT[state])}>
      <StateDot state={state} />
      {label ?? STATE_LABELS[state]}
    </span>
  );
}
