/**
 * Task state machine. Every task is always in exactly one of these states,
 * and only the transitions listed in TRANSITIONS are allowed.
 */

export const TASK_STATES = [
  "idle",
  "working",
  "needs_input",
  "stuck",
  "ready_for_review",
  "merged",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  idle: ["working"],
  working: ["needs_input", "stuck", "ready_for_review"],
  needs_input: ["working"],
  stuck: ["working"],
  ready_for_review: ["working", "merged"],
  merged: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskState,
    readonly to: TaskState,
  ) {
    super(`Invalid task transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** States that need the user. They sort first and get the strongest signal. */
export const ATTENTION_STATES: readonly TaskState[] = ["needs_input", "stuck"];

export function isAttention(state: TaskState): boolean {
  return ATTENTION_STATES.includes(state);
}

/** Lower sorts first: what needs the user, then what's ready, then the rest. */
export const STATE_PRIORITY: Readonly<Record<TaskState, number>> = {
  needs_input: 0,
  stuck: 1,
  ready_for_review: 2,
  working: 3,
  idle: 4,
  merged: 5,
};

export const STATE_LABELS: Readonly<Record<TaskState, string>> = {
  idle: "Idle",
  working: "Working",
  needs_input: "Needs input",
  stuck: "Stuck",
  ready_for_review: "Ready for review",
  merged: "Merged",
};
