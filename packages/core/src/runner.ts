import type { Diff } from "./diff";
import type { AgentMessage, RunnerEvent } from "./events";
import type { CreateTaskInput, Task } from "./task";

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

/**
 * The only thing the UI talks to. runner-mock, runner-local and the future
 * cloud runner all implement it, so it must stay stable.
 */
export interface Runner {
  /** Snapshot of every task, for first render. Live changes come via subscribe. */
  listTasks(): Promise<Task[]>;
  /** Full conversation so far, for opening a task that is already running. */
  getMessages(id: string): Promise<AgentMessage[]>;

  createTask(input: CreateTaskInput): Promise<Task>;
  startTask(id: string): Promise<void>;
  /** Reply to a question, nudge a stuck task, or request changes after review. */
  sendMessage(id: string, message: string): Promise<void>;
  stopTask(id: string): Promise<void>;
  getDiff(id: string): Promise<Diff>;
  merge(id: string, opts: MergeOptions): Promise<void>;
  openPullRequest(id: string, opts: PROptions): Promise<{ url: string }>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}
