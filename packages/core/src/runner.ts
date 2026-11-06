import type { Diff, DiffFile } from "./diff";
import type { AgentMessage, RunnerEvent } from "./events";
import type { AgentKind, CreateTaskInput, Task } from "./task";

export type MergeStrategy = "merge" | "squash" | "rebase";

export interface MergeOptions {
  targetBranch: string;
  commitMessage: string;
  strategy: MergeStrategy;
  /** Remove the task's branch and worktree after merging. */
  deleteBranch?: boolean;
}

export interface PROptions {
  title: string;
  body: string;
  baseBranch: string;
  draft?: boolean;
}

/** Everything a UI needs to draw, taken at one instant. */
export interface RunnerSnapshot {
  tasks: Task[];
  messages: Record<string, AgentMessage[]>;
  diffs: Record<string, DiffFile[]>;
  /** Terminal output so far per task, in order. */
  terminal: Record<string, string[]>;
}

/**
 * The only thing the UI talks to. runner-mock, runner-local and the future
 * cloud runner all implement it, so it must stay stable.
 */
export interface Runner {
  /**
   * The whole state, for first render and after a reconnect. Live changes come
   * via subscribe. Must be built from memory without yielding, so that no event
   * can land between two parts of it: an event is either in the snapshot or
   * delivered after it, never both or neither.
   */
  snapshot(): Promise<RunnerSnapshot>;
  listTasks(): Promise<Task[]>;
  /** Full conversation so far, for opening a task that is already running. */
  getMessages(id: string): Promise<AgentMessage[]>;

  createTask(input: CreateTaskInput): Promise<Task>;
  startTask(id: string): Promise<void>;
  /**
   * Reply to a question, nudge a stuck task, or request changes after review.
   * Passing `agent` hands the task to a different agent from this message on.
   */
  sendMessage(id: string, message: string, opts?: { agent?: AgentKind }): Promise<void>;
  stopTask(id: string): Promise<void>;
  getDiff(id: string): Promise<Diff>;
  merge(id: string, opts: MergeOptions): Promise<void>;
  openPullRequest(id: string, opts: PROptions): Promise<{ url: string }>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}
