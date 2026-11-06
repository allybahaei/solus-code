import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentEvent, AgentSession, AgentStart } from "./agent";
import { CodexStream, type CodexLine } from "./codex-stream";
import { BRIDGE, ToolServer } from "./tool-server";

export interface CodexOptions {
  /** The executable. Tests point this at a stand-in. */
  command?: string;
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

/** TOML for `-c`; a JSON string is a valid TOML string. */
const toml = (value: string) => JSON.stringify(value);

/** Runs the user's own `codex` on their own login, one process per turn. */
export class CodexAdapter implements AgentAdapter {
  constructor(private readonly options: CodexOptions = {}) {}

  start(start: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    return new CodexSession(start, emit, this.options);
  }
}

class CodexSession implements AgentSession {
  private readonly tools: ToolServer;
  private readonly stallMs: number;
  private child: ChildProcess | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private thread: string | undefined;
  /** Replies that arrived mid-turn. Codex can't take input until the turn ends. */
  private queued: string[] = [];
  private turn = 0;
  private over = false;

  constructor(
    private readonly start: AgentStart,
    private readonly emit: (event: AgentEvent) => void,
    private readonly options: CodexOptions,
  ) {
    this.stallMs = options.stallMs ?? STALL_MS;
    this.thread = start.session;
    this.tools = new ToolServer({ onAsk: (question) => emit({ type: "ask", question }) });
    if (process.env.CODEX_API_KEY) {
      emit({
        type: "terminal",
        data: "\x1b[33mCODEX_API_KEY is set, so Codex may bill the API instead of your subscription.\x1b[0m\r\n",
      });
    }
    this.run(this.thread ? start.prompt : `${INSTRUCTIONS}\n\n${start.prompt}`);
  }

  send(message: string): void {
    if (this.child) this.queued.push(message);
    else this.run(message);
  }

  approve(): void {
    // `codex exec` never asks: its sandbox is the boundary.
  }

  stop(): void {
    if (this.over) return;
    this.over = true;
    const child = this.child;
    child?.kill("SIGINT");
    const force = setTimeout(() => child?.kill("SIGKILL"), KILL_AFTER_MS);
    force.unref();
    child?.once("close", () => clearTimeout(force));
    this.clearStall();
    this.tools.close();
  }

  private args(prompt: string): string[] {
    const config = [
      // `exec resume` has no --sandbox flag, so set it the same way on every turn.
      `sandbox_mode=${toml("workspace-write")}`,
      `mcp_servers.solus.command=${toml(process.execPath)}`,
      `mcp_servers.solus.args=[${toml(BRIDGE)}]`,
      `mcp_servers.solus.env.SOLUS_SOCKET=${toml(this.tools.socketPath)}`,
      `mcp_servers.solus.default_tools_approval_mode=${toml("approve")}`,
    ].flatMap((c) => ["-c", c]);
    return this.thread
      ? ["exec", "resume", "--json", ...config, "--", this.thread, prompt]
      : ["exec", "--json", ...config, "--", prompt];
  }

  private run(prompt: string) {
    const isFirstRun = this.turn === 0;
    const stream = new CodexStream(this.start.cwd, ++this.turn);
    let stderr = "";

    const child = spawn(this.options.command ?? "codex", this.args(prompt), {
      cwd: this.start.cwd,
      // stdin must be closed, or `codex exec` waits for it forever.
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.armStall();

    createInterface({ input: child.stdout as NodeJS.ReadableStream }).on("line", (raw) => {
      if (this.over) return;
      let line: CodexLine;
      try {
        line = JSON.parse(raw) as CodexLine;
      } catch {
        return;
      }
      this.armStall();
      for (const event of stream.push(line)) {
        if (event.type === "session") this.thread = event.id;
        if (event.type === "error") {
          // `codex login status` can't see an expired token, so it shows up here.
          const expired = /refresh token|sign in again|log in again|logged in/i.test(event.error.message);
          const fix = "Run `codex logout`, then `codex login`, in a terminal, then nudge this task.";
          this.finish(expired ? { type: "error", error: { ...event.error, detail: fix } } : event);
          return;
        }
        this.emit(event);
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      this.fail(err.code === "ENOENT" ? "Codex isn't installed, or `codex` isn't on your PATH." : err.message);
    });
    child.on("close", (code) => {
      this.child = null;
      this.clearStall();
      if (this.over) return;
      if (!stream.finished) {
        if (isFirstRun && this.start.session && stderr.includes("no rollout found")) {
          this.finish({ type: "session_lost" });
        } else {
          this.fail(`Codex exited unexpectedly (code ${code})`, stderr.trim());
        }
        return;
      }
      if (this.queued.length > 0) {
        const next = this.queued.join("\n\n");
        this.queued = [];
        this.run(next);
      } else {
        this.emit({ type: "turn_end" });
      }
    });
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
