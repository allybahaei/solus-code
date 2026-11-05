import type { DiffFile, MessageRole, TaskError, TaskState } from "@solus/core";

/**
 * A scripted step. `after` is the pause before it, in ms at speed 1.
 * Steps run one after another; agent messages stream word by word.
 */
export type Step =
  | { kind: "say"; after: number; text: string }
  | { kind: "tool"; after: number; tool: string; text: string }
  | { kind: "term"; after: number; data: string }
  | { kind: "diff"; after: number; files: DiffFile[] }
  | { kind: "ask"; after: number; question: string }
  | { kind: "fail"; after: number; error: TaskError }
  | { kind: "done"; after: number };

export const say = (after: number, text: string): Step => ({ kind: "say", after, text });
export const tool = (after: number, name: string, text: string): Step => ({
  kind: "tool",
  after,
  tool: name,
  text,
});
export const term = (after: number, data: string): Step => ({ kind: "term", after, data });
export const diff = (after: number, ...files: DiffFile[]): Step => ({ kind: "diff", after, files });
export const ask = (after: number, question: string): Step => ({ kind: "ask", after, question });
export const fail = (after: number, message: string, detail?: string): Step => ({
  kind: "fail",
  after,
  error: detail === undefined ? { message } : { message, detail },
});
export const done = (after: number): Step => ({ kind: "done", after });

/** Terminal colours, for realistic xterm output. */
export const ansi = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

/** A shell command: shows as a Bash tool call and writes prompt + output to the terminal. */
export function bash(after: number, command: string, output: string[]): Step[] {
  return [
    tool(after, "Bash", command),
    term(150, [`${ansi.dim("$")} ${command}`, ...output, ""].join("\r\n")),
  ];
}

/** What the mock plays as the user when autopilot is on. */
export type AutoAction =
  | { when: "idle"; after: number; do: "start" }
  | { when: "needs_input" | "stuck" | "ready_for_review"; after: number; do: "reply"; text: string }
  | { when: "ready_for_review"; after: number; do: "merge" | "pr" };

export interface HistoryEntry {
  /** ms before the runner was created. */
  ago: number;
  role: MessageRole;
  text: string;
  tool?: string;
}

export interface Scenario {
  id: string;
  title: string;
  prompt: string;
  branch: string;
  state: TaskState;
  /** ms before the runner was created. */
  createdAgo: number;
  /** Seeded so the board has real-looking ages from the first render. */
  question?: string;
  history?: HistoryEntry[];
  initialDiff?: DiffFile[];
  /** Played on start, or right away when the task is seeded as working. */
  run?: Step[];
  /** After the user answers a needs_input question. */
  onReply?: Step[];
  /** After the user nudges a stuck task. */
  onNudge?: Step[];
  /** After the user requests changes on a ready_for_review task. */
  onRevise?: Step[];
  autopilot?: AutoAction[];
}
