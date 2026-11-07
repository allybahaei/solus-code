import { STATE_PRIORITY, type TaskState } from "./state";

/** Which agent runs the task. */
export const AGENT_KINDS = ["claude-code", "claude", "codex", "opencode", "cursor", "gemini"] as const;
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
  /** The PR's branch on origin, when the task's own branch has another name. */
  head?: string;
  /** The PR comes from a fork, which Solus can't push to. */
  fork?: boolean;
}

export interface PullRequestCheck {
  name: string;
  state: "pending" | "passed" | "failed" | "skipped";
  url?: string;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  /** Set on a comment about a line of the diff. */
  path?: string;
  line?: number;
  url?: string;
}

export interface PullRequestStatus {
  state: "open" | "merged" | "closed";
  conflicts: boolean;
  /** GitHub's value, such as APPROVED or CHANGES_REQUESTED. */
  reviewDecision?: string;
  checks: PullRequestCheck[];
  comments: PullRequestComment[];
}

/** The chat every task starts with. Its messages have no chatId. */
export const MAIN_CHAT = "main";

/** How a chat's agent runs. Changing these takes effect on its next message. */
export interface ChatOptions {
  model?: string;
  effort?: string;
  /** Propose a plan and change nothing until told to. */
  plan?: boolean;
}

/** A message waiting for the agent to finish its turn. */
export interface QueuedMessage {
  id: string;
  text: string;
}

/** A model an agent can run, and the effort levels it takes. */
export interface ModelOption {
  id: string;
  label: string;
  efforts: string[];
}

/** One conversation with an agent. All of a task's chats share its worktree. */
export interface Chat {
  id: string;
  title: string;
  agent: AgentKind;
  /** Never merged: only the task as a whole merges. */
  state: TaskState;
  createdAt: Timestamp;
  question?: string;
  approval?: ApprovalRequest;
  error?: TaskError;
  options?: ChatOptions;
  /** Waiting to go, oldest first. */
  queued?: QueuedMessage[];
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
  /** Set while archived: out of the way, with its branch and history kept. */
  archivedAt?: Timestamp;
  /** First of the task's block of ports, for running several apps side by side. */
  port?: number;
  /** The saved command running now, if any. */
  running?: string;
  /** Absent on runners without chats: see chatsOf. */
  chats?: Chat[];
  /** The task's pull request. It may still be open: the state says if it landed. */
  pullRequest?: PullRequestRef;
  /** Set once merged locally: the branch it was merged into. */
  mergedInto?: string;
  /** Snapshots of the worktree, by the user message they were taken before. */
  checkpoints?: Record<string, string>;
}

/** Where a task can start other than a blank prompt. */
export type TaskSource = { type: "branch"; branch: string } | { type: "pr"; number: number } | { type: "issue"; number: number };

export interface TaskSources {
  branches: string[];
  pullRequests: { number: number; title: string }[];
  issues: { number: number; title: string }[];
}

export interface CreateTaskInput {
  repo: string;
  /** Can be empty with a source, which then supplies it. */
  title: string;
  /** Added to what the source provides. */
  prompt: string;
  baseBranch: string;
  /** Defaults to claude-code. */
  agent?: AgentKind;
  source?: TaskSource;
}

/** A task's chats. A task without any behaves as one chat. */
export function chatsOf(task: Task): Chat[] {
  if (task.chats?.length) return task.chats;
  const { agent, state, createdAt, question, approval, error } = task;
  return [
    {
      id: MAIN_CHAT,
      title: "Chat",
      agent,
      state,
      createdAt,
      ...(question ? { question } : {}),
      ...(approval ? { approval } : {}),
      ...(error ? { error } : {}),
    },
  ];
}

const CHAT_ORDER: readonly TaskState[] = ["needs_input", "stuck", "working", "ready_for_review", "idle"];

/** The chat that speaks for the task: whichever most needs a person, then whichever is busy. */
export function leadChat(chats: readonly Chat[]): Chat | undefined {
  for (const state of CHAT_ORDER) {
    const chat = chats.find((c) => c.state === state);
    if (chat) return chat;
  }
  return undefined;
}

/** Board order: attention states first, then most recent activity. */
export function compareTasks(a: Task, b: Task): number {
  return (
    STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
    b.lastActivityAt - a.lastActivityAt
  );
}
