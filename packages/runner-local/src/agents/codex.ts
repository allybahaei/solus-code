import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { PLAN_ONLY, type AgentAdapter, type AgentEvent, type AgentSession, type AgentStart } from "./agent";
import { CodexStream, unwrapCommand, type CodexNotification } from "./codex-stream";
import { BRIDGE, bridgeEnv, ToolServer } from "./tool-server";

export interface CodexOptions {
  /** The executable. Tests point this at a stand-in. */
  command?: string;
  /** A turn with no output for this long counts as stuck. */
  stallMs?: number;
}

const STALL_MS = 10 * 60_000;
const KILL_AFTER_MS = 3000;
const METHOD_NOT_FOUND = -32601;

const INSTRUCTIONS = [
  "You are running inside Solus, in a git worktree made for this task. A person reviews your diff when you finish.",
  "When you need a decision from them, call the ask_user tool from the solus MCP server, then end your turn. Their answer arrives as your next message.",
  "Leave your changes in the working tree. Solus handles committing and merging.",
].join(" ");

/** TOML for `-c`; a JSON string is a valid TOML string. */
const toml = (value: string) => JSON.stringify(value);

/** A JSON-RPC line from `codex app-server`: a reply, a request or a notification. */
interface Line extends Partial<CodexNotification> {
  id?: number | string;
  result?: unknown;
  error?: { message?: string };
}

interface ApprovalRequest {
  command?: string | null;
  reason?: string | null;
}

/** Runs the user's own `codex` on their own login, one process per session. */
export class CodexAdapter implements AgentAdapter {
  constructor(private readonly options: CodexOptions = {}) {}

  start(start: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    return new CodexSession(start, emit, this.options);
  }
}

class CodexSession implements AgentSession {
  private readonly tools: ToolServer;
  private readonly stallMs: number;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stream: CodexStream;
  private readonly replies = new Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();
  /** Requests from Codex waiting on the person, by the id shown to the UI. */
  private readonly approvals = new Map<string, number | string>();
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private thread: string | undefined;
  private turnId: string | undefined;
  /** Busy, so messages wait. Starts true: opening the thread leads into the first turn. */
  private inTurn = true;
  /** Replies that arrived mid-turn, sent as one message when it ends. */
  private queued: string[] = [];
  private nextId = 0;
  private stderr = "";
  private over = false;

  constructor(
    private readonly start: AgentStart,
    private readonly emit: (event: AgentEvent) => void,
    private readonly options: CodexOptions,
  ) {
    this.stallMs = options.stallMs ?? STALL_MS;
    this.thread = start.session;
    this.stream = new CodexStream(start.cwd);
    this.tools = new ToolServer({ onAsk: (question) => emit({ type: "ask", question }) });
    if (process.env.CODEX_API_KEY) {
      emit({
        type: "terminal",
        data: "\x1b[33mCODEX_API_KEY is set, so Codex may bill the API instead of your subscription.\x1b[0m\r\n",
      });
    }

    this.child = spawn(options.command ?? "codex", this.args(), {
      cwd: start.cwd,
      env: { ...process.env, ...start.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (raw) => this.onLine(raw));
    this.child.stderr.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-2000);
    });
    this.child.stdin.on("error", () => {});
    this.child.on("error", (err: NodeJS.ErrnoException) => {
      this.fail(err.code === "ENOENT" ? "Codex isn't installed, or `codex` isn't on your PATH." : err.message);
    });
    this.child.on("close", (code) => {
      this.clearStall();
      if (this.over) return;
      if (/unrecognized subcommand/.test(this.stderr)) this.fail("This version of Codex is too old for Solus.", "Update it with `npm i -g @openai/codex`.");
      else this.fail(`Codex exited unexpectedly (code ${code})`, this.stderr.trim());
    });

    void this.open();
  }

  send(message: string): void {
    // With an approval pending, the message is the reason for saying no.
    for (const id of [...this.approvals.keys()]) this.approve(id, false);
    if (this.inTurn) this.queued.push(message);
    else this.runTurn(message);
  }

  approve(id: string, allow: boolean): void {
    const request = this.approvals.get(id);
    if (request === undefined) return;
    this.approvals.delete(id);
    this.write({ id: request, result: { decision: allow ? "accept" : "decline" } });
    this.armStall();
  }

  stop(): void {
    if (this.over) return;
    this.over = true;
    if (this.thread && this.turnId) this.write({ id: ++this.nextId, method: "turn/interrupt", params: { threadId: this.thread, turnId: this.turnId } });
    const { child } = this;
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
    force.unref();
    child.once("close", () => clearTimeout(force));
    this.clearStall();
    this.tools.close();
  }

  /** Solus's tool, and Codex's sandbox, are set for the whole session. */
  private args(): string[] {
    const config = [
      `mcp_servers.solus.command=${toml(process.execPath)}`,
      `mcp_servers.solus.args=[${toml(BRIDGE)}]`,
      `mcp_servers.solus.env.SOLUS_SOCKET=${toml(this.tools.socketPath)}`,
      ...Object.entries(bridgeEnv()).map(([name, value]) => `mcp_servers.solus.env.${name}=${toml(value)}`),
      `mcp_servers.solus.default_tools_approval_mode=${toml("approve")}`,
    ].flatMap((c) => ["-c", c]);
    return ["app-server", ...config];
  }

  private async open() {
    const { options } = this.start;
    const settings = {
      cwd: this.start.cwd,
      // Read-only makes plan mode a fact, not just a request.
      sandbox: options?.plan ? "read-only" : "workspace-write",
      approvalPolicy: "on-request",
      developerInstructions: options?.plan ? `${INSTRUCTIONS} ${PLAN_ONLY}` : INSTRUCTIONS,
      ...(options?.model ? { model: options.model } : {}),
    };
    try {
      await this.call("initialize", { clientInfo: { name: "solus", title: "Solus", version: "0.1.0" }, capabilities: null });
      this.write({ method: "initialized" });
      const opened = (await this.call(this.thread ? "thread/resume" : "thread/start", {
        ...settings,
        ...(this.thread ? { threadId: this.thread, excludeTurns: true } : {}),
      })) as { thread: { id: string } };
      this.thread = opened.thread.id;
      this.emit({ type: "session", id: opened.thread.id });
      this.runTurn(this.start.prompt);
    } catch (err) {
      if (this.over) return;
      const message = err instanceof Error ? err.message : String(err);
      if (this.start.session && message.includes("no rollout found")) this.finish({ type: "session_lost" });
      else this.fail(message);
    }
  }

  private runTurn(text: string) {
    this.inTurn = true;
    this.armStall();
    const effort = this.start.options?.effort;
    this.call("turn/start", { threadId: this.thread, input: [{ type: "text", text }], ...(effort ? { effort } : {}) }).then(
      (result) => {
        this.turnId = (result as { turn: { id: string } }).turn.id;
      },
      (err: Error) => this.fail(err.message),
    );
  }

  private call(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.replies.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private write(message: unknown) {
    if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onLine(raw: string) {
    if (this.over) return;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      return;
    }
    if (line.id !== undefined && !line.method) {
      const reply = this.replies.get(line.id as number);
      this.replies.delete(line.id as number);
      if (line.error) reply?.reject(new Error(line.error.message ?? "Codex refused the request."));
      else reply?.resolve(line.result);
    } else if (line.id !== undefined && line.method) {
      this.onRequest(line.id, line.method, line.params as ApprovalRequest | undefined);
    } else if (line.method) {
      this.onNotification({ method: line.method, ...(line.params ? { params: line.params } : {}) });
    }
  }

  private onRequest(id: number | string, method: string, params: ApprovalRequest | undefined) {
    const approval =
      method === "item/commandExecution/requestApproval"
        ? { tool: "Bash", summary: unwrapCommand(params?.command ?? params?.reason ?? "") }
        : method === "item/fileChange/requestApproval"
          ? { tool: "Edit", summary: params?.reason ?? "Change files" }
          : undefined;
    if (!approval) {
      // Answer, so Codex never waits on something Solus doesn't do. That includes login tokens.
      this.write({ id, error: { code: METHOD_NOT_FOUND, message: `Solus doesn't support ${method}.` } });
      return;
    }
    const shown = `codex-${id}`;
    this.approvals.set(shown, id);
    this.clearStall(); // The person may take their time.
    this.emit({ type: "approval", id: shown, ...approval });
  }

  private onNotification(notification: CodexNotification) {
    if (this.inTurn && this.approvals.size === 0) this.armStall();
    for (const event of this.stream.push(notification)) {
      if (event.type === "error") {
        // `codex login status` can't see an expired token, so it shows up here.
        const expired = /refresh token|sign in again|log in again|logged in/i.test(event.error.message);
        const fix = "Run `codex logout`, then `codex login`, in a terminal, then nudge this task.";
        this.finish(expired ? { type: "error", error: { ...event.error, detail: fix } } : event);
        return;
      }
      if (event.type === "turn_end") this.endTurn();
      else this.emit(event);
    }
  }

  private endTurn() {
    this.inTurn = false;
    this.turnId = undefined;
    this.clearStall();
    if (this.queued.length > 0) {
      const next = this.queued.join("\n\n");
      this.queued = [];
      this.runTurn(next);
    } else {
      this.emit({ type: "turn_end" });
    }
  }

  private armStall() {
    this.clearStall();
    this.stallTimer = setTimeout(() => {
      this.fail(`No output from Codex for ${Math.round(this.stallMs / 60_000)} minutes`);
    }, this.stallMs);
  }

  private clearStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private fail(message: string, detail?: string) {
    this.finish({ type: "error", error: detail ? { message, detail } : { message } });
  }

  private finish(event: AgentEvent) {
    if (this.over) return;
    this.stop();
    this.emit(event);
  }
}
