import type { Diff, DiffFile } from "./diff";
import type { AgentMessage, RunnerEvent } from "./events";
import type { AgentKind, Chat, ChatOptions, CreateTaskInput, ModelOption, PullRequestStatus, Task, TaskSources } from "./task";

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

export interface RepoInfo {
  /** owner/name, or the folder name when there's no remote. */
  name: string;
  /** Local path, for runners that have one. */
  path?: string;
  defaultBranch: string;
  /** Names of the saved commands in solus.json. */
  actions: string[];
}

/** One thing Solus depends on. */
export interface SetupCheck {
  id: string;
  label: string;
  state: "ready" | "missing" | "signed_out" | "problem";
  /** What was found, or why it matters. */
  detail?: string;
  /** A command or step that fixes it. */
  fix?: string;
}

export interface AgentCheck extends SetupCheck {
  agent: AgentKind;
  /** Solus can install it with installAgent. */
  installable?: boolean;
}

/** Agents this runner can run, and the other tools it relies on. */
export interface SetupStatus {
  agents: AgentCheck[];
  tools: SetupCheck[];
}

/** An app that can open a task's folder. */
export interface OpenTarget {
  id: string;
  label: string;
  kind: "editor" | "terminal" | "finder";
}

/** The person's preferences, shared by all their repos. */
export interface Settings {
  /** Play a sound when a task needs them. */
  sound: boolean;
  /** Show a system notification when a task needs them. */
  notifications: boolean;
  /** The OpenTarget that `O` uses. */
  editor?: string;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, notifications: true };

/** Everything a UI needs to draw, taken at one instant. */
export interface RunnerSnapshot {
  repo: RepoInfo;
  tasks: Task[];
  messages: Record<string, AgentMessage[]>;
  diffs: Record<string, DiffFile[]>;
  /** Terminal output so far per task, in order. */
  terminal: Record<string, string[]>;
  /** Output from saved commands per task, in order. */
  runOutput: Record<string, string[]>;
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
  /** Checks installs and logins. Costs no agent usage. */
  checkSetup(): Promise<SetupStatus>;
  /** Installs an agent's official package, on the user's say-so. Resolves with fresh checks. */
  installAgent(agent: AgentKind): Promise<SetupStatus>;
  listTasks(): Promise<Task[]>;
  /** Full conversation so far, for opening a task that is already running. */
  getMessages(id: string): Promise<AgentMessage[]>;

  createTask(input: CreateTaskInput): Promise<Task>;
  /** Branches, open PRs and issues a task could start from. */
  listSources(): Promise<TaskSources>;
  /** Saves a file where the task's agent can read it. Returns its path in the worktree. */
  attachFile(id: string, name: string, base64: string): Promise<string>;
  startTask(id: string): Promise<void>;
  /**
   * Reply to a question, nudge a stuck task, or request changes after review.
   * Passing `agent` hands the task to a different agent from this message on.
   */
  /** Goes to the main chat unless opts.chat says otherwise. */
  sendMessage(id: string, message: string, opts?: { agent?: AgentKind; chat?: string }): Promise<void>;
  /** Adds a conversation in the task's worktree. */
  createChat(id: string, agent?: AgentKind): Promise<Chat>;
  /** Answers the task's pending approval. To deny with a reason, use sendMessage. */
  answerApproval(id: string, approvalId: string, allow: boolean): Promise<void>;
  /** Stops one chat, or every running chat if none is named. */
  stopTask(id: string, chat?: string): Promise<void>;
  /** Merges `target` into the task's branch and has the agent resolve what conflicts. */
  resolveConflicts(id: string, target: string): Promise<void>;
  /** Stops the task, commits its work, and frees its worktree. Keeps the branch and history. */
  archiveTask(id: string): Promise<void>;
  /** Brings an archived task back, with its worktree. */
  restoreTask(id: string): Promise<void>;
  /** Stops the task and removes it, with its local branch, worktree and history. */
  deleteTask(id: string): Promise<void>;
  /** Runs a saved command in the task's worktree, replacing any already running. */
  startAction(id: string, name: string): Promise<void>;
  stopAction(id: string): Promise<void>;
  /** Types into the task's shell, starting it if needed. Empty data just starts it. */
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  getDiff(id: string, opts?: { ignoreWhitespace?: boolean }): Promise<Diff>;
  /** Puts the worktree back as it was before a message. Later changes are lost. */
  restoreCheckpoint(id: string, messageId: string): Promise<void>;
  readFile(id: string, path: string): Promise<string>;
  /** Saves a file in the task's worktree. */
  writeFile(id: string, path: string, content: string): Promise<void>;
  /** Files in the task's worktree, or the repo before it has one, for mentioning. */
  listFiles(id: string): Promise<string[]>;
  /** Models an agent can run. Empty when Solus can't choose one for it. */
  listModels(agent: AgentKind): Promise<ModelOption[]>;
  /** Sets how a chat's agent runs, from its next message on. */
  setChatOptions(id: string, options: ChatOptions, chat?: string): Promise<void>;
  /** Rewrites a waiting message. Empty text removes it. */
  editQueued(id: string, queuedId: string, text: string, chat?: string): Promise<void>;
  /** Apps on this machine that can open a task's folder. */
  listOpenTargets(): Promise<OpenTarget[]>;
  /** Opens the task's worktree in one of those apps. */
  openWorkspace(id: string, target: string): Promise<void>;
  getSettings(): Promise<Settings>;
  /** Changes some settings and resolves with all of them. */
  saveSettings(changes: Partial<Settings>): Promise<Settings>;
  merge(id: string, opts: MergeOptions): Promise<void>;
  openPullRequest(id: string, opts: PROptions): Promise<{ url: string }>;
  /** Returns an unsubscribe function. */
  /** CI and review state from GitHub. Moves the task to merged if the PR has landed. */
  getPullRequest(id: string): Promise<PullRequestStatus>;
  /** Commits the task's work and pushes it to its pull request. */
  pushPullRequest(id: string): Promise<void>;
  /** Pushes any new work, then merges the pull request on GitHub. */
  mergePullRequest(id: string, strategy: MergeStrategy): Promise<void>;
  /** The end of a failed check's log, or nothing if it isn't available. */
  getCheckLog(id: string, url: string): Promise<string>;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}
