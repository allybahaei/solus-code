import { STATE_PRIORITY, type TaskState } from "./state";

/** Which agent runs the task. */
export const AGENT_KINDS = ["claude-code", "claude", "codex", "gemini"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Epoch milliseconds. Plain numbers so tasks serialize cleanly over the wire. */
export type Timestamp = number;

export interface ChangeStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface TaskError {
  message: string;
  /** Extra context, such as the failing command's output. */
  detail?: string;
}

/** A tool call waiting for the user's yes or no. */
export interface ApprovalRequest {
  id: string;
  tool: string;
  /** What it wants to do, such as the shell command. */
  summary: string;
}

export interface PullRequestRef {
  url: string;
  number: number;
}

export interface Task {
  id: string;
  title: string;
  /** The instruction the agent was started with. */
  prompt: string;
  /** owner/name of the repository. */
  repo: string;
  /** The task's own branch, checked out in its worktree. */
  branch: string;
  baseBranch: string;
  agent: AgentKind;
  state: TaskState;
  changes: ChangeStats;
  createdAt: Timestamp;
  /** Last time anything happened on the task: output, state change, diff. */
  lastActivityAt: Timestamp;
  /** Set while state is needs_input: what the agent is asking. */
  question?: string;
  /** Set while state is needs_input and the agent is asking to run something. */
  approval?: ApprovalRequest;
  /** Set while state is stuck: why. */
  error?: TaskError;
  /** First of the task's block of ports, for running several apps side by side. */
  port?: number;
  /** The saved command running now, if any. */
  running?: string;
  /** Set once merged through a pull request. */
  pullRequest?: PullRequestRef;
  /** Set once merged locally: the branch it was merged into. */
  mergedInto?: string;
}

export interface CreateTaskInput {
  repo: string;
  title: string;
  prompt: string;
  baseBranch: string;
  /** Defaults to claude-code. */
  agent?: AgentKind;
}

/** Board order: attention states first, then most recent activity. */
export function compareTasks(a: Task, b: Task): number {
  return (
    STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
    b.lastActivityAt - a.lastActivityAt
  );
}
