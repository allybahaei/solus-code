import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { createInterface } from "node:readline";
import { PLAN_ONLY, type AgentAdapter, type AgentEvent, type AgentSession, type AgentStart } from "./agent";
import { BRIDGE, bridgeEnv, ToolServer } from "./tool-server";

export interface AcpOptions {
  /** Shown in errors, such as "OpenCode". */
  label: string;
  /** The executable and the arguments that start its ACP server. */
  command: string;
  args: string[];
  /** Added to the agent's environment, such as its permission settings. */
  env?: NodeJS.ProcessEnv;
  /** What to run when the agent isn't signed in. */
  login: string;
  /** Sent to `authenticate` before a session, for agents that require it. */
  authMethod?: string;
  /** A turn with no output for this long counts as stuck. */
  stallMs?: number;
}

const STALL_MS = 10 * 60_000;
const KILL_AFTER_MS = 3000;

const INSTRUCTIONS = [
  "You are running inside Solus, in a git worktree made for this task. A person reviews your diff when you finish.",
  "When you need a decision from them, call the ask_user tool from the solus MCP server, then end your turn. Their answer arrives as your next message.",
  "Leave your changes in the working tree. Solus handles committing and merging.",
].join(" ");

interface RpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

interface ToolCall {
  toolCallId: string;
  name?: string;
  kind?: string;
  title?: string;
  status?: string;
  rawInput?: { command?: string; path?: string; filePath?: string };
}

interface Update extends Partial<ToolCall> {
  sessionUpdate: string;
  messageId?: string;
  content?: { type?: string; text?: string };
}

interface PermissionOption {
  optionId: string;
  kind: string;
}

interface Pending {
  rpc: number;
  options: PermissionOption[];
}

/** Cursor's titles are Markdown, with the whole command in backticks. */
const plain = (title: string) => title.replace(/^`(.*)`$/s, "$1");

/** Runs an agent's own CLI through the Agent Client Protocol: one process, many turns. */
export class AcpAdapter implements AgentAdapter {
  constructor(private readonly options: AcpOptions) {}

  start(start: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    return new AcpSession(start, emit, this.options);
  }
}

class AcpSession implements AgentSession {
  private readonly tools: ToolServer;
  private readonly child: ChildProcess;
  private readonly stallMs: number;
  private readonly waiting = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: RpcError) => void }>();
  private readonly calls = new Map<string, ToolCall>();
  private readonly approvals = new Map<string, Pending>();
  /** Cursor reports a refused call as completed, so Solus has to remember. */
  private readonly refused = new Set<string>();
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;
  private sessionId: string | undefined;
  /** The message being streamed, to close when the next thing starts. */
  private openText: string | undefined;
  /** session/load replays the whole history, which has already been shown. */
  private replaying = false;
  private turning = false;
  private queued: string[] = [];
  private stderr = "";
  private over = false;

  constructor(
    private readonly start: AgentStart,
    private readonly emit: (event: AgentEvent) => void,
    private readonly options: AcpOptions,
  ) {
    this.stallMs = options.stallMs ?? STALL_MS;
    this.tools = new ToolServer({ onAsk: (question) => emit({ type: "ask", question }) });
    this.child = spawn(options.command, options.args, {
      cwd: start.cwd,
      env: { ...process.env, ...start.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on("line", (raw) => this.onLine(raw));
    this.child.stderr?.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-2000);
    });
    // A closed pipe surfaces through the close event below.
    this.child.stdin?.on("error", () => {});
    this.child.on("error", (err: NodeJS.ErrnoException) => {
      this.fail(err.code === "ENOENT" ? `${options.label} isn't installed, or \`${options.command}\` isn't on your PATH.` : err.message);
    });
    this.child.on("close", (code) => {
      if (!this.over) this.fail(`${options.label} exited unexpectedly (code ${code})`, this.stderr.trim());
    });
    void this.open();
  }

  send(message: string): void {
    // With an approval pending, the message is the reason for saying no.
    for (const id of [...this.approvals.keys()]) this.approve(id, false);
    if (this.turning) this.queued.push(message);
    else void this.turn(message);
  }

  approve(id: string, allow: boolean): void {
    const pending = this.approvals.get(id);
    if (!pending) return;
    this.approvals.delete(id);
    if (!allow) this.refused.add(id);
    const kinds = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
    const option = kinds.map((k) => pending.options.find((o) => o.kind === k)).find(Boolean);
    this.write({
      id: pending.rpc,
      result: { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } },
    });
    this.armStall();
  }

  stop(): void {
    if (this.over) return;
    this.over = true;
    this.clearStall();
    this.child.kill("SIGTERM");
    const force = setTimeout(() => this.child.kill("SIGKILL"), KILL_AFTER_MS);
    force.unref();
    this.child.once("close", () => clearTimeout(force));
    this.tools.close();
  }

  private async open() {
    const mcpServers = [
      {
        name: "solus",
        command: process.execPath,
        args: [BRIDGE],
        env: [
          ...Object.entries(bridgeEnv()).map(([name, value]) => ({ name, value })),
          { name: "SOLUS_SOCKET", value: this.tools.socketPath },
        ],
      },
    ];
    const { cwd, session, prompt } = this.start;
    try {
      await this.call("initialize", { protocolVersion: 1, clientCapabilities: {} });
      if (this.options.authMethod) await this.call("authenticate", { methodId: this.options.authMethod });
      if (session) {
        this.replaying = true;
        try {
          await this.call("session/load", { sessionId: session, cwd, mcpServers });
        } catch (err) {
          if (err instanceof RpcError) {
            this.finish({ type: "session_lost" });
            return;
          }
          throw err;
        }
        this.replaying = false;
        this.sessionId = session;
      } else {
        const created = await this.call("session/new", { cwd, mcpServers });
        this.sessionId = String(created.sessionId);
        this.emit({ type: "session", id: this.sessionId });
      }
      await this.turn(session ? prompt : `${INSTRUCTIONS}\n\n${prompt}`);
    } catch (err) {
      this.failFrom(err);
    }
  }

  private async turn(text: string) {
    this.turning = true;
    this.armStall();
    try {
      const result = await this.call("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text: this.start.options?.plan ? `${PLAN_ONLY}\n\n${text}` : text }],
      });
      if (this.over) return;
      this.closeText();
      this.clearStall();
      this.turning = false;
      if (result.stopReason === "refusal") {
        this.fail(`${this.options.label} refused to continue.`);
      } else if (this.queued.length > 0) {
        const next = this.queued.join("\n\n");
        this.queued = [];
        await this.turn(next);
      } else {
        this.emit({ type: "turn_end" });
      }
    } catch (err) {
      this.failFrom(err);
    }
  }

  private onLine(raw: string) {
    if (this.over) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(raw) as RpcMessage;
    } catch {
      return;
    }
    if (message.method === "session/update") this.onUpdate(message.params?.update as Update);
    else if (message.method === "session/request_permission") this.onPermission(message);
    else if (message.method && message.id !== undefined) {
      // Solus offers no client methods, such as file access, so anything else is refused.
      this.write({ id: message.id, error: { code: -32601, message: "Method not found" } });
    } else if (message.id !== undefined) {
      const call = this.waiting.get(message.id);
      this.waiting.delete(message.id);
      if (message.error) call?.reject(new RpcError(message.error.message ?? "Unknown error"));
      else call?.resolve(message.result ?? {});
    }
  }

  private onUpdate(update: Update) {
    if (this.replaying || !update) return;
    this.armStall();
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const chunk = update.content?.text;
        if (!chunk) return;
        const id = update.messageId ?? this.openText ?? `acp-${randomUUID()}`;
        if (id !== this.openText) this.closeText();
        this.openText = id;
        this.emit({ type: "text", id, chunk, done: false });
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        this.closeText();
        const id = update.toolCallId as string;
        const call = { ...this.calls.get(id), ...update, toolCallId: id };
        this.calls.set(id, call);
        const finished = update.status === "completed" || update.status === "failed";
        if (finished && !this.refused.has(id)) this.toolDone(call);
        return;
      }
    }
  }

  private toolDone(call: ToolCall) {
    const path = call.rawInput?.path ?? call.rawInput?.filePath;
    const text = plain(call.rawInput?.command ?? (path ? relative(this.start.cwd, path) : (call.title ?? call.name ?? "tool")));
    const failed = call.status === "failed";
    this.emit({ type: "tool", tool: call.name ?? call.kind ?? "tool", text: failed ? `Failed: ${text}` : text });
    // A refused command never ran, so it doesn't belong in the terminal.
    if (call.kind === "execute" && !failed) this.emit({ type: "terminal", data: `$ ${text}\r\n` });
    this.emit({ type: "files_changed" });
  }

  private onPermission(message: RpcMessage) {
    const params = message.params as { toolCall: ToolCall; options: PermissionOption[] };
    const { toolCall, options } = params;
    const pending = { rpc: message.id as number, options };
    const id = toolCall.toolCallId;
    // This has the real command, which a refusal's update may not repeat.
    this.calls.set(id, { ...this.calls.get(id), ...toolCall });
    this.approvals.set(id, pending);
    // Its own question to the person never needs a second yes.
    if (/ask_user/.test(toolCall.name ?? toolCall.title ?? "")) {
      this.approve(id, true);
      return;
    }
    this.closeText();
    // A person can take as long as they like, so nothing counts as stalled.
    this.clearStall();
    this.emit({
      type: "approval",
      id,
      tool: toolCall.name ?? toolCall.kind ?? "tool",
      summary: plain(toolCall.rawInput?.command ?? toolCall.title ?? "Run a tool"),
    });
  }

  private closeText() {
    if (this.openText === undefined) return;
    this.emit({ type: "text", id: this.openText, chunk: "", done: true });
    this.openText = undefined;
  }

  private call(method: string, params: Record<string, unknown>) {
    const id = ++this.nextId;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private write(message: object) {
    if (!this.over) this.child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  }

  private armStall() {
    this.clearStall();
    if (this.approvals.size > 0) return;
    this.stallTimer = setTimeout(() => {
      this.fail(`No output from ${this.options.label} for ${Math.round(this.stallMs / 60_000)} minutes`);
    }, this.stallMs);
  }

  private clearStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private failFrom(err: unknown) {
    if (this.over) return;
    const message = err instanceof Error ? err.message : String(err);
    const signedOut = /auth|log ?in|sign(ed)? ?in|credential|api key/i.test(message);
    this.fail(message, signedOut ? `Run \`${this.options.login}\` in a terminal, then nudge this task.` : undefined);
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

class RpcError extends Error {}

/** Cursor asks through the protocol itself, so Solus's approvals work as they are. */
export function cursorAdapter(command: string): AcpAdapter {
  return new AcpAdapter({ label: "Cursor", command, args: ["acp"], login: `${command} login`, authMethod: "cursor_login" });
}

/**
 * OpenCode runs commands without asking unless told otherwise, and has no
 * sandbox, so commands and web requests go through Solus's approvals.
 */
export function openCodeAdapter(command = "opencode", model = process.env.SOLUS_OPENCODE_MODEL): AcpAdapter {
  const config = { permission: { bash: "ask", webfetch: "ask" }, ...(model ? { model } : {}) };
  return new AcpAdapter({
    label: "OpenCode",
    command,
    args: ["acp"],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    login: "opencode auth login",
  });
}
