import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertTransition,
  diffStats,
  type AgentKind,
  type AgentMessage,
  type CreateTaskInput,
  type Diff,
  type DiffFile,
  type MessageRole,
  type RepoInfo,
  type Runner,
  type RunnerEvent,
  type RunnerSnapshot,
  type Task,
  type TaskError,
  type TaskState,
} from "@solus/core";
import type { AgentAdapter, AgentEvent, AgentSession } from "./agents/agent";
import { readDiff } from "./diff";
import { readRepo } from "./git";
import { TaskStore, type StoredTask } from "./store";
import { SetupError, copyFiles, createWorktree, readRepoConfig, runSetup, slugify, uniqueBranch } from "./workspace";

export interface LocalRunnerOptions {
  repoPath: string;
  /** Picks the adapter for a task's agent. */
  adapterFor: (agent: AgentKind) => AgentAdapter;
  /** Where saved state and worktrees live. Defaults to ~/.solus. */
  home?: string;
}

interface Rec extends StoredTask {
  messages: AgentMessage[];
  /** The agent message being streamed, by the adapter's id. */
  streaming: Map<string, AgentMessage>;
  terminal: string[];
  files: DiffFile[];
  session?: AgentSession;
  /** Bumped to abandon a launch that is still preparing. */
  launch: number;
  abort?: AbortController;
  /** Agent events for this task, handled strictly in order. */
  queue: Promise<void>;
}

const repoKey = (root: string) =>
  `${slugify(root.split("/").at(-1) ?? "repo")}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;

const describe = (err: unknown): TaskError =>
  err instanceof SetupError
    ? { message: err.message, detail: err.detail }
    : { message: err instanceof Error ? err.message : String(err) };

/** Runs tasks in real git worktrees, with real diffs and saved state. */
export class LocalRunner implements Runner {
  private readonly records = new Map<string, Rec>();
  private readonly listeners = new Set<(event: RunnerEvent) => void>();
  private nextMessage = 1;

  private constructor(
    private readonly repo: RepoInfo & { path: string },
    private readonly store: TaskStore,
    private readonly worktrees: string,
    private readonly adapterFor: (agent: AgentKind) => AgentAdapter,
  ) {}

  /** Opens a repo, restoring its saved tasks. Rejects if it isn't usable. */
  static async open({ repoPath, adapterFor, home }: LocalRunnerOptions): Promise<LocalRunner> {
    const repo = await readRepo(repoPath);
    const root = repo.path as string;
    const dir = home ?? join(homedir(), ".solus");
    const key = repoKey(root);
    const runner = new LocalRunner(
      { ...repo, path: root },
      new TaskStore(join(dir, "repos", key)),
      join(dir, "worktrees", key),
      adapterFor,
    );
    await runner.restore();
    return runner;
  }

  /** Stops every agent. Tasks keep their saved state. */
  dispose(): void {
    for (const rec of this.records.values()) {
      rec.launch++;
      rec.abort?.abort();
      rec.session?.stop();
    }
    this.listeners.clear();
  }

  /* ---------------------------- Runner API ---------------------------- */

  async snapshot(): Promise<RunnerSnapshot> {
    const records = [...this.records.values()];
    const byTask = <T>(fn: (r: Rec) => T) =>
      Object.fromEntries(records.map((r) => [r.task.id, structuredClone(fn(r))]));
    return {
      repo: this.repoInfo(),
      tasks: records.map((r) => structuredClone(r.task)),
      messages: byTask((r) => r.messages),
      diffs: byTask((r) => r.files),
      terminal: byTask((r) => r.terminal),
    };
  }

  async listTasks(): Promise<Task[]> {
    return [...this.records.values()].map((r) => structuredClone(r.task));
  }

  async getMessages(id: string): Promise<AgentMessage[]> {
    return structuredClone(this.get(id).messages);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const taken = new Set([...this.records.values()].map((r) => r.task.branch));
    const branch = await uniqueBranch(this.repo.path, input.title, taken);
    const now = Date.now();
    const task: Task = {
      id: `tsk_${randomBytes(6).toString("hex")}`,
      title: input.title,
      prompt: input.prompt,
      repo: this.repo.name,
      branch,
      baseBranch: input.baseBranch,
      agent: input.agent ?? "claude-code",
      state: "idle",
      changes: { files: 0, additions: 0, deletions: 0 },
      createdAt: now,
      lastActivityAt: now,
    };
    this.records.set(task.id, this.newRecord({ task }));
    this.save();
    this.emit({ type: "task.created", taskId: task.id, at: now, task: structuredClone(task) });
    return structuredClone(task);
  }

  async startTask(id: string): Promise<void> {
    const rec = this.get(id);
    if (rec.task.state !== "idle") throw new Error(`Task ${id} is already started (${rec.task.state}).`);
    this.addMessage(rec, "user", rec.task.prompt);
    this.setState(rec, "working");
    void this.launch(rec, rec.task.prompt);
  }

  async sendMessage(id: string, message: string, opts: { agent?: AgentKind } = {}): Promise<void> {
    const rec = this.get(id);
    const { state } = rec.task;
    if (state === "idle") throw new Error(`Start task ${id} before messaging it.`);
    if (state === "merged") throw new Error(`Task ${id} is merged.`);

    if (opts.agent && opts.agent !== rec.task.agent) {
      // A different agent can't continue this one's session.
      rec.task.agent = opts.agent;
      rec.session?.stop();
      delete rec.session;
      delete rec.agentStarted;
    }
    this.addMessage(rec, "user", message);
    if (state !== "working") this.setState(rec, "working");
    if (rec.session) rec.session.send(message);
    else void this.launch(rec, message);
  }

  async stopTask(id: string): Promise<void> {
    const rec = this.get(id);
    if (rec.task.state !== "working") return;
    rec.launch++;
    rec.abort?.abort();
    rec.session?.stop();
    delete rec.session;
    this.setState(rec, "stuck", { error: { message: "Stopped by you" } });
  }

  async getDiff(id: string): Promise<Diff> {
    const rec = this.get(id);
    return {
      taskId: id,
      baseBranch: rec.task.baseBranch,
      branch: rec.task.branch,
      files: structuredClone(rec.files),
    };
  }

  merge(id: string): Promise<void> {
    this.get(id);
    return Promise.reject(new Error("Merging isn't connected to real repositories yet."));
  }

  openPullRequest(id: string): Promise<{ url: string }> {
    this.get(id);
    return Promise.reject(new Error("Pull requests aren't connected to real repositories yet."));
  }

  subscribe(listener: (event: RunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ----------------------------- internals ---------------------------- */

  private repoInfo(): RepoInfo {
    return { name: this.repo.name, path: this.repo.path, defaultBranch: this.repo.defaultBranch };
  }

  private newRecord(stored: StoredTask): Rec {
    return { ...stored, messages: [], streaming: new Map(), terminal: [], files: [], launch: 0, queue: Promise.resolve() };
  }

  private async restore() {
    for (const stored of this.store.loadTasks()) {
      const rec = this.newRecord(stored);
      rec.messages = this.store.loadMessages(stored.task.id);
      rec.terminal = this.store.loadTerminal(stored.task.id);
      // Its agent died with the last daemon. Replying starts it again.
      if (rec.task.state === "working") {
        rec.task.state = "stuck";
        rec.task.error = { message: "Solus restarted while this task was running" };
      }
      if (rec.worktree && existsSync(rec.worktree)) {
        try {
          rec.files = await readDiff(rec.worktree, rec.task.baseBranch);
          rec.task.changes = diffStats(rec.files);
        } catch {
          // The saved numbers stand. The next refresh will try again.
        }
      }
      this.records.set(rec.task.id, rec);
    }
    this.save();
  }

  private get(id: string): Rec {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`Unknown task: ${id}`);
    return rec;
  }

  private save() {
    this.store.saveTasks(
      [...this.records.values()].map(({ task, worktree, setupDone, agentStarted }) => ({
        task,
        ...(worktree ? { worktree } : {}),
        ...(setupDone ? { setupDone } : {}),
        ...(agentStarted ? { agentStarted } : {}),
      })),
    );
  }

  private emit(event: RunnerEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("runner listener threw", err);
      }
    }
  }

  private touch(rec: Rec): number {
    return (rec.task.lastActivityAt = Date.now());
  }

  private setState(rec: Rec, to: TaskState, extra: Pick<Partial<Task>, "question" | "error"> = {}) {
    const from = rec.task.state;
    assertTransition(from, to);
    rec.task.state = to;
    delete rec.task.question;
    delete rec.task.error;
    Object.assign(rec.task, extra);
    const at = this.touch(rec);
    this.save();
    this.emit({ type: "task.state_changed", taskId: rec.task.id, at, from, to, task: structuredClone(rec.task) });
  }

  private addMessage(rec: Rec, role: MessageRole, text: string, tool?: string) {
    const at = this.touch(rec);
    const id = `msg_${at}_${this.nextMessage++}`;
    const message: AgentMessage = { id, taskId: rec.task.id, role, text, at, ...(tool ? { tool } : {}) };
    rec.messages.push(message);
    this.store.appendMessage(message);
    this.emit({
      type: "agent.output",
      taskId: rec.task.id,
      at,
      messageId: id,
      role,
      chunk: text,
      done: true,
      ...(tool ? { tool } : {}),
    });
  }

  private term(rec: Rec, data: string) {
    const at = this.touch(rec);
    rec.terminal.push(data);
    this.store.appendTerminal(rec.task.id, data);
    this.emit({ type: "terminal.output", taskId: rec.task.id, at, data });
  }

  private async refreshDiff(rec: Rec) {
    if (!rec.worktree) return;
    rec.files = await readDiff(rec.worktree, rec.task.baseBranch);
    rec.task.changes = diffStats(rec.files);
    const at = this.touch(rec);
    this.save();
    this.emit({ type: "diff.updated", taskId: rec.task.id, at, changes: { ...rec.task.changes } });
  }

  /** Creates the worktree on first use, then starts or resumes the agent. */
  private async launch(rec: Rec, message: string) {
    const launch = ++rec.launch;
    const abandoned = () => launch !== rec.launch;
    const abort = (rec.abort = new AbortController());
    try {
      await this.prepare(rec, abort.signal);
      if (abandoned()) return;
      const cwd = rec.worktree as string;
      // An agent that never ran has no session to resume, and hasn't seen the task.
      const resume = rec.agentStarted === true;
      const { prompt: task } = rec.task;
      const prompt = resume || message === task ? message : `${task}\n\n${message}`;
      rec.agentStarted = true;
      this.save();
      rec.session = this.adapterFor(rec.task.agent).start(
        { taskId: rec.task.id, cwd, prompt, resume },
        (event) => {
          if (!abandoned()) rec.queue = rec.queue.then(() => this.onAgentEvent(rec, event));
        },
      );
    } catch (err) {
      if (abandoned()) return;
      if (rec.task.state === "working") this.setState(rec, "stuck", { error: describe(err) });
    }
  }

  private async prepare(rec: Rec, signal: AbortSignal) {
    const { task } = rec;
    if (!rec.worktree) {
      const path = join(this.worktrees, task.id);
      this.term(rec, `\x1b[2mCreating worktree for ${task.branch}…\x1b[0m\r\n`);
      await createWorktree(this.repo.path, path, task.branch, task.baseBranch);
      rec.worktree = path;
      this.save();
    }
    if (rec.setupDone) return;
    const config = readRepoConfig(this.repo.path);
    const copied = copyFiles(this.repo.path, rec.worktree, config.copy ?? []);
    if (copied.length > 0) this.term(rec, `\x1b[2mCopied ${copied.join(", ")}\x1b[0m\r\n`);
    if (config.setup) {
      this.term(rec, `\x1b[2m$ ${config.setup}\x1b[0m\r\n`);
      await runSetup(config.setup, rec.worktree, (data) => this.term(rec, data), signal);
    }
    rec.setupDone = true;
    this.save();
  }

  private async onAgentEvent(rec: Rec, event: AgentEvent) {
    try {
      switch (event.type) {
        case "text":
          this.onText(rec, event);
          break;
        case "tool":
          this.addMessage(rec, "tool", event.text, event.tool);
          break;
        case "terminal":
          this.term(rec, event.data);
          break;
        case "files_changed":
          await this.refreshDiff(rec);
          break;
        case "ask":
          if (rec.task.state === "working") this.setState(rec, "needs_input", { question: event.question });
          break;
        case "turn_end":
          await this.refreshDiff(rec);
          if (rec.task.state === "working") this.setState(rec, "ready_for_review");
          break;
        case "error":
          delete rec.session;
          if (rec.task.state === "working") this.setState(rec, "stuck", { error: event.error });
          break;
      }
    } catch (err) {
      this.emit({
        type: "error",
        taskId: rec.task.id,
        at: Date.now(),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private onText(rec: Rec, event: Extract<AgentEvent, { type: "text" }>) {
    const at = this.touch(rec);
    let message = rec.streaming.get(event.id);
    if (!message) {
      message = { id: event.id, taskId: rec.task.id, role: "agent", text: "", at };
      rec.streaming.set(event.id, message);
      rec.messages.push(message);
    }
    message.text += event.chunk;
    this.emit({
      type: "agent.output",
      taskId: rec.task.id,
      at,
      messageId: event.id,
      role: "agent",
      chunk: event.chunk,
      done: event.done,
    });
    if (event.done) {
      rec.streaming.delete(event.id);
      this.store.appendMessage(message);
    }
  }
}
