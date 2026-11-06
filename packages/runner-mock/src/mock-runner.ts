import {
  assertTransition,
  diffStats,
  type AgentKind,
  type AgentMessage,
  type CreateTaskInput,
  type Diff,
  type DiffFile,
  type MergeOptions,
  type MessageRole,
  type PROptions,
  type Runner,
  type RunnerEvent,
  type RunnerSnapshot,
  type Task,
  type TaskState,
} from "@solus/core";
import {
  MOCK_BASE_BRANCH,
  MOCK_REPO,
  SCENARIOS,
  branchFor,
  genericAck,
  genericNudge,
  genericReply,
  genericRevise,
  genericRun,
} from "./scenarios";
import { ansi, say, tool, type AutoAction, type Scenario, type Step } from "./script";

export interface MockRunnerOptions {
  /** Time multiplier: 2 plays scripts twice as fast. Default 1. */
  speed?: number;
  /**
   * Play the user too: answer questions, nudge stuck tasks, request changes
   * and merge, so every task moves through its states with no input.
   */
  autopilot?: boolean;
  scenarios?: readonly Scenario[];
}

interface TaskRecord {
  task: Task;
  scenario: Scenario | undefined;
  messages: AgentMessage[];
  files: Map<string, DiffFile>;
  terminal: string[];
  /** Bumped to cancel the script that is playing. */
  scriptGen: number;
  /** Bumped on every state change, to drop stale autopilot actions. */
  stateGen: number;
  autopilot: AutoAction[];
}

/**
 * When a request for changes carries review comments ("path:line" blocks),
 * the agent first says which files it is going back to, then opens them.
 */
function reviewAck(message: string): Step[] {
  const refs = [...message.matchAll(/^([\w./@-]+\.\w+):\d+/gm)].map((m) => m[1] ?? "").filter(Boolean);
  if (refs.length === 0) return [];
  const paths = [...new Set(refs)];
  const list = paths.map((p) => `\`${p}\``).join(", ");
  return [
    say(500, `Going through your ${refs.length} review ${refs.length === 1 ? "comment" : "comments"} in ${list}.`),
    ...paths.map((p, i) => tool(i === 0 ? 700 : 400, "Read", p)),
  ];
}

const WORDS_PER_CHUNK = 3;
const CHUNK_INTERVAL_MS = 45;

/** Scripted, in-memory Runner for the prototype. No git, no agents. */
export class MockRunner implements Runner {
  private readonly records = new Map<string, TaskRecord>();
  private readonly listeners = new Set<(event: RunnerEvent) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly speed: number;
  private readonly autopilotOn: boolean;
  private nextTaskNumber = 1;
  private nextMessageNumber = 1;
  private nextPrNumber = 412;
  private disposed = false;

  constructor(options: MockRunnerOptions = {}) {
    this.speed = options.speed ?? 1;
    this.autopilotOn = options.autopilot ?? false;
    const now = Date.now();
    for (const s of options.scenarios ?? SCENARIOS) this.seed(s, now);
    for (const rec of this.records.values()) {
      if (rec.task.state === "working") this.play(rec, rec.scenario?.run ?? genericRun(rec.task));
      this.scheduleAutopilot(rec);
    }
  }

  /** Stops every timer. The runner emits nothing afterwards. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
  }

  /* ---------------------------- Runner API ---------------------------- */

  async snapshot(): Promise<RunnerSnapshot> {
    const records = [...this.records.values()];
    const byTask = <T>(fn: (r: TaskRecord) => T) =>
      Object.fromEntries(records.map((r) => [r.task.id, structuredClone(fn(r))]));
    return {
      repo: { name: MOCK_REPO, defaultBranch: MOCK_BASE_BRANCH },
      tasks: records.map((r) => structuredClone(r.task)),
      messages: byTask((r) => r.messages),
      diffs: byTask((r) => [...r.files.values()]),
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
    const now = Date.now();
    const task: Task = {
      id: `tsk_${String(this.nextTaskNumber++).padStart(3, "0")}`,
      title: input.title,
      prompt: input.prompt,
      repo: input.repo,
      branch: branchFor(input.title),
      baseBranch: input.baseBranch,
      agent: input.agent ?? "claude-code",
      state: "idle",
      changes: { files: 0, additions: 0, deletions: 0 },
      createdAt: now,
      lastActivityAt: now,
    };
    this.records.set(task.id, this.newRecord(task, undefined));
    this.emit({ type: "task.created", taskId: task.id, at: now, task: structuredClone(task) });
    return structuredClone(task);
  }

  async startTask(id: string): Promise<void> {
    const rec = this.get(id);
    if (rec.task.state !== "idle") throw new Error(`Task ${id} is already started (${rec.task.state}).`);
    this.addMessage(rec, "user", rec.task.prompt);
    this.setState(rec, "working");
    this.term(rec, `${ansi.dim(`Preparing worktree for ${rec.task.branch}…`)}\r\n`);
    this.play(rec, rec.scenario?.run ?? genericRun(rec.task));
  }

  async sendMessage(id: string, message: string, opts: { agent?: AgentKind } = {}): Promise<void> {
    const rec = this.get(id);
    const { state } = rec.task;
    if (state === "idle") throw new Error(`Start task ${id} before messaging it.`);
    if (state === "merged") throw new Error(`Task ${id} is merged.`);
    // The mock plays the same script whichever agent is chosen; it only records it.
    if (opts.agent) rec.task.agent = opts.agent;

    this.addMessage(rec, "user", message);
    switch (state) {
      case "needs_input":
        this.setState(rec, "working");
        this.play(rec, rec.scenario?.onReply ?? genericReply);
        break;
      case "stuck":
        this.setState(rec, "working");
        this.play(rec, rec.scenario?.onNudge ?? genericNudge);
        break;
      case "ready_for_review": {
        this.setState(rec, "working");
        const steps = rec.scenario?.onRevise ?? genericRevise;
        // A scenario's revision only plays once; later rounds are generic.
        if (rec.scenario) rec.scenario = { ...rec.scenario, onRevise: genericRevise };
        this.play(rec, [...reviewAck(message), ...steps]);
        break;
      }
      case "working":
        this.play(rec, genericAck, { append: true });
        break;
    }
  }

  async answerApproval(id: string): Promise<void> {
    throw new Error(`Task ${id} has nothing to approve; the mock never asks.`);
  }

  async writeTerminal(): Promise<void> {
    // The mock's terminal only shows scripted output.
  }

  async resizeTerminal(): Promise<void> {
    // Nothing to resize.
  }

  async stopTask(id: string): Promise<void> {
    const rec = this.get(id);
    if (rec.task.state !== "working") return;
    rec.scriptGen++;
    this.term(rec, `${ansi.yellow("^C")}\r\n`);
    this.setState(rec, "stuck", { error: { message: "Stopped by you" } });
  }

  async getDiff(id: string): Promise<Diff> {
    const rec = this.get(id);
    return {
      taskId: id,
      baseBranch: rec.task.baseBranch,
      branch: rec.task.branch,
      files: structuredClone([...rec.files.values()]),
    };
  }

  async merge(id: string, opts: MergeOptions): Promise<void> {
    const rec = this.get(id);
    this.requireReview(rec, "merge");
    const { files, additions, deletions } = rec.task.changes;
    this.term(
      rec,
      [
        `${ansi.dim("$")} git checkout ${opts.targetBranch} && git merge ${opts.strategy === "squash" ? "--squash " : ""}${rec.task.branch}`,
        ` ${files} files changed, ${ansi.green(`${additions} insertions(+)`)}, ${ansi.red(`${deletions} deletions(-)`)}`,
        "",
      ].join("\r\n"),
    );
    this.setState(rec, "merged", { mergedInto: opts.targetBranch });
  }

  async openPullRequest(id: string, opts: PROptions): Promise<{ url: string }> {
    const rec = this.get(id);
    this.requireReview(rec, "open a pull request for");
    const number = this.nextPrNumber++;
    const url = `https://github.com/${rec.task.repo}/pull/${number}`;
    this.term(
      rec,
      [
        `${ansi.dim("$")} gh pr create --base ${opts.baseBranch} --title "${opts.title}"${opts.draft ? " --draft" : ""}`,
        url,
        "",
      ].join("\r\n"),
    );
    this.setState(rec, "merged", { pullRequest: { url, number } });
    return { url };
  }

  subscribe(listener: (event: RunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ----------------------------- internals ---------------------------- */

  private seed(s: Scenario, now: number): void {
    const files = s.initialDiff ?? [];
    const history = s.history ?? [];
    const lastAgo = Math.min(s.createdAgo, ...history.map((h) => h.ago));
    const task: Task = {
      id: s.id,
      title: s.title,
      prompt: s.prompt,
      repo: MOCK_REPO,
      branch: s.branch,
      baseBranch: MOCK_BASE_BRANCH,
      agent: "claude-code",
      state: s.state,
      changes: diffStats(files),
      createdAt: now - s.createdAgo,
      lastActivityAt: now - lastAgo,
      ...(s.question ? { question: s.question } : {}),
    };
    const rec = this.newRecord(task, s);
    for (const f of files) rec.files.set(f.path, f);
    for (const h of history) {
      rec.messages.push({
        id: this.messageId(),
        taskId: s.id,
        role: h.role,
        text: h.text,
        at: now - h.ago,
        ...(h.tool ? { tool: h.tool } : {}),
      });
    }
    this.records.set(s.id, rec);
  }

  private newRecord(task: Task, scenario: Scenario | undefined): TaskRecord {
    return {
      task,
      scenario,
      messages: [],
      files: new Map(),
      terminal: [],
      scriptGen: 0,
      stateGen: 0,
      autopilot: [...(scenario?.autopilot ?? [])],
    };
  }

  private get(id: string): TaskRecord {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`Unknown task: ${id}`);
    return rec;
  }

  private requireReview(rec: TaskRecord, action: string): void {
    if (rec.task.state !== "ready_for_review") {
      throw new Error(`Can't ${action} task ${rec.task.id} while it is ${rec.task.state}.`);
    }
  }

  private emit(event: RunnerEvent): void {
    if (this.disposed) return;
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("runner-mock listener threw", err);
      }
    }
  }

  private schedule(ms: number, fn: () => void): void {
    if (this.disposed) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms / this.speed);
    this.timers.add(t);
  }

  private touch(rec: TaskRecord): number {
    const now = Date.now();
    rec.task.lastActivityAt = now;
    return now;
  }

  private messageId(): string {
    return `msg_${this.nextMessageNumber++}`;
  }

  private setState(
    rec: TaskRecord,
    to: TaskState,
    extra: Pick<Partial<Task>, "question" | "error" | "pullRequest" | "mergedInto"> = {},
  ): void {
    const from = rec.task.state;
    assertTransition(from, to);
    rec.task.state = to;
    delete rec.task.question;
    delete rec.task.error;
    Object.assign(rec.task, extra);
    rec.stateGen++;
    const at = this.touch(rec);
    this.emit({
      type: "task.state_changed",
      taskId: rec.task.id,
      at,
      from,
      to,
      task: structuredClone(rec.task),
    });
    this.scheduleAutopilot(rec);
  }

  /** A complete message, emitted as a single chunk. */
  private addMessage(rec: TaskRecord, role: MessageRole, text: string, toolName?: string): void {
    const at = this.touch(rec);
    const id = this.messageId();
    rec.messages.push({ id, taskId: rec.task.id, role, text, at, ...(toolName ? { tool: toolName } : {}) });
    this.emit({
      type: "agent.output",
      taskId: rec.task.id,
      at,
      messageId: id,
      role,
      chunk: text,
      done: true,
      ...(toolName ? { tool: toolName } : {}),
    });
  }

  /** An agent message, streamed a few words at a time. Calls `then` after the last chunk. */
  private stream(rec: TaskRecord, text: string, gen: number, then: () => void): void {
    const words = text.match(/\S+\s*/g) ?? [text];
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
      chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(""));
    }
    const id = this.messageId();
    const message: AgentMessage = { id, taskId: rec.task.id, role: "agent", text: "", at: Date.now() };
    rec.messages.push(message);

    const send = (i: number) => {
      if (gen !== rec.scriptGen) return;
      const chunk = chunks[i] ?? "";
      message.text += chunk;
      const at = this.touch(rec);
      const done = i === chunks.length - 1;
      this.emit({ type: "agent.output", taskId: rec.task.id, at, messageId: id, role: "agent", chunk, done });
      if (done) then();
      else this.schedule(CHUNK_INTERVAL_MS, () => send(i + 1));
    };
    send(0);
  }

  private term(rec: TaskRecord, data: string): void {
    const at = this.touch(rec);
    rec.terminal.push(data);
    this.emit({ type: "terminal.output", taskId: rec.task.id, at, data });
  }

  /**
   * Plays steps in order, replacing whatever script was playing.
   * With `append`, plays alongside it instead (for a quick acknowledgement).
   */
  private play(rec: TaskRecord, steps: readonly Step[], opts: { append?: boolean } = {}): void {
    const gen = opts.append ? rec.scriptGen : ++rec.scriptGen;
    let i = 0;
    const next = () => {
      const step = steps[i++];
      if (!step || gen !== rec.scriptGen) return;
      this.schedule(step.after, () => {
        if (gen !== rec.scriptGen) return;
        this.runStep(rec, step, gen, next);
      });
    };
    next();
  }

  private runStep(rec: TaskRecord, step: Step, gen: number, next: () => void): void {
    switch (step.kind) {
      case "say":
        this.stream(rec, step.text, gen, next);
        return;
      case "tool":
        this.addMessage(rec, "tool", step.text, step.tool);
        break;
      case "term":
        this.term(rec, step.data);
        break;
      case "diff": {
        for (const f of step.files) rec.files.set(f.path, f);
        rec.task.changes = diffStats([...rec.files.values()]);
        const at = this.touch(rec);
        this.emit({ type: "diff.updated", taskId: rec.task.id, at, changes: { ...rec.task.changes } });
        break;
      }
      case "ask":
        this.setState(rec, "needs_input", { question: step.question });
        return;
      case "fail":
        this.setState(rec, "stuck", { error: step.error });
        return;
      case "done":
        this.setState(rec, "ready_for_review");
        return;
    }
    next();
  }

  /** If autopilot has an action for the task's new state, play it after a pause. */
  private scheduleAutopilot(rec: TaskRecord): void {
    if (!this.autopilotOn) return;
    const action = rec.autopilot[0];
    if (!action || action.when !== rec.task.state) return;
    rec.autopilot.shift();
    const gen = rec.stateGen;
    this.schedule(action.after, () => {
      if (rec.stateGen !== gen) return; // the user (or a script) got there first
      this.perform(rec, action).catch((err: unknown) => {
        this.emit({
          type: "error",
          taskId: rec.task.id,
          at: Date.now(),
          message: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  private perform(rec: TaskRecord, action: AutoAction): Promise<unknown> {
    const { task } = rec;
    switch (action.do) {
      case "start":
        return this.startTask(task.id);
      case "reply":
        return this.sendMessage(task.id, action.text);
      case "merge":
        return this.merge(task.id, {
          targetBranch: task.baseBranch,
          commitMessage: task.title,
          strategy: "squash",
          deleteBranch: true,
        });
      case "pr":
        return this.openPullRequest(task.id, {
          title: task.title,
          body: task.prompt,
          baseBranch: task.baseBranch,
        });
    }
  }
}

export function createMockRunner(options?: MockRunnerOptions): MockRunner {
  return new MockRunner(options);
}
