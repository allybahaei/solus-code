import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentEvent, AgentSession, AgentStart } from "./agent";
import { ClaudeStream, summarizeTool, type ClaudeLine } from "./claude-stream";
import { BRIDGE, bridgeEnv, ToolServer } from "./tool-server";

export interface ClaudeCodeOptions {
  /** The executable. Tests point this at a stand-in. */
  command?: string;
  /** A turn with no output for this long counts as stuck. */
  stallMs?: number;
}

const STALL_MS = 10 * 60_000;
const KILL_AFTER_MS = 3000;
/** An approval waits for a person, so the tool call mustn't time out first. */
const ONE_DAY_MS = "86400000";

/** Commands that run without asking. Everything else comes to the user. */
export const ALLOWED_TOOLS = [
  "mcp__solus__ask_user",
  "mcp__solus__set_branch_name",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git branch:*)",
  "Bash(ls:*)",
  "Bash(pwd)",
  "Bash(rg:*)",
  ...["npm", "pnpm", "yarn", "bun"].flatMap((pm) => [
    `Bash(${pm} test:*)`,
    `Bash(${pm} run test:*)`,
    `Bash(${pm} run lint:*)`,
    `Bash(${pm} run typecheck:*)`,
    `Bash(${pm} run build:*)`,
  ]),
  "Bash(pnpm lint:*)",
  "Bash(pnpm typecheck:*)",
  "Bash(pnpm build:*)",
];

const SYSTEM_PROMPT = [
  "You are running inside Solus, in a git worktree made for this task. A person reviews your diff when you finish.",
  "When you need a decision from them, call the ask_user tool, then end your turn. Their answer arrives as your next message.",
  "Before your first edit in a new task, call the set_branch_name tool, once.",
  "Leave your changes in the working tree. Solus handles committing and merging.",
].join(" ");

const userLine = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";

/** Runs the user's own `claude` on their own login. */
export class ClaudeCodeAdapter implements AgentAdapter {
  constructor(private readonly options: ClaudeCodeOptions = {}) {}

  start(start: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    return new ClaudeSession(start, emit, this.options);
  }
}

interface Pending {
  socket: Socket;
  input: Record<string, unknown>;
}

class ClaudeSession implements AgentSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private tools: ToolServer | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly stallMs: number;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private inTurn = false;
  private over = false;
  private stderr = "";

  constructor(
    private readonly start: AgentStart,
    private readonly emit: (event: AgentEvent) => void,
    private readonly options: ClaudeCodeOptions,
  ) {
    this.stallMs = options.stallMs ?? STALL_MS;

    if (process.env.CLAUDECODE) {
      // Claude Code refuses this, and warns that nesting can crash live sessions.
      this.fail("Solus was started from inside Claude Code, so it can't run Claude Code. Start Solus from a normal terminal.");
      return;
    }
    if (process.env.ANTHROPIC_API_KEY) {
      emit({
        type: "terminal",
        data: "\x1b[33mANTHROPIC_API_KEY is set, so Claude Code may bill the API instead of your subscription.\x1b[0m\r\n",
      });
    }
    this.tools = new ToolServer({
      onAsk: (question) => emit({ type: "ask", question }),
      onBranchName: (name) => emit({ type: "branch_name", name }),
      onApproval: (socket, args) => this.onApproval(socket, args),
    });
    this.launch(this.tools);
  }

  send(message: string): void {
    const waiting = [...this.pending.keys()];
    if (waiting.length > 0) {
      for (const id of waiting) this.answer(id, { behavior: "deny", message });
      this.beginTurn();
      return;
    }
    this.child?.stdin.write(userLine(message));
    this.beginTurn();
  }

  approve(id: string, allow: boolean): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.answer(id, allow ? { behavior: "allow", updatedInput: pending.input } : { behavior: "deny", message: "The person said no." });
    this.beginTurn();
  }

  stop(): void {
    if (this.over) return;
    this.over = true;
    const child = this.child;
    child?.kill("SIGINT");
    const force = setTimeout(() => child?.kill("SIGKILL"), KILL_AFTER_MS);
    force.unref();
    child?.once("close", () => clearTimeout(force));
    this.cleanUp();
  }

  private answer(id: string, decision: object) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    ToolServer.reply(pending.socket, JSON.stringify(decision));
  }

  private onApproval(socket: Socket, args: Record<string, unknown>) {
    const id = randomUUID();
    const input = (args.input ?? {}) as Record<string, unknown>;
    const tool = String(args.tool_name ?? "a tool");
    this.pending.set(id, { socket, input });
    this.clearStall();
    this.emit({ type: "approval", id, tool, summary: summarizeTool(tool, input, this.start.cwd) });
  }

  private launch(tools: ToolServer) {
    const { cwd, session, prompt, options } = this.start;
    const sessionId = session ?? randomUUID();
    const mcpConfig = join(tools.dir, "mcp.json");
    writeFileSync(
      mcpConfig,
      JSON.stringify({
        mcpServers: {
          solus: { command: process.execPath, args: [BRIDGE], env: { ...bridgeEnv(), SOLUS_SOCKET: tools.socketPath } },
        },
      }),
    );

    const child = spawn(
      this.options.command ?? "claude",
      [
        "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        ...(session ? ["--resume", session] : ["--session-id", sessionId]),
        "--permission-mode", options?.plan ? "plan" : "acceptEdits",
        ...(options?.model ? ["--model", options.model] : []),
        ...(options?.effort ? ["--effort", options.effort] : []),
        "--mcp-config", mcpConfig,
        "--permission-prompt-tool", "mcp__solus__approve",
        // One argument each: these contain spaces.
        "--allowedTools", ...ALLOWED_TOOLS,
        "--append-system-prompt", SYSTEM_PROMPT,
      ],
      { cwd, env: { ...process.env, ...this.start.env, MCP_TOOL_TIMEOUT: ONE_DAY_MS }, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    this.emit({ type: "session", id: sessionId });

    const stream = new ClaudeStream(cwd);
    createInterface({ input: child.stdout }).on("line", (raw) => this.onLine(stream, raw));
    child.stderr.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (err: NodeJS.ErrnoException) => {
      this.fail(err.code === "ENOENT" ? "Claude Code isn't installed, or `claude` isn't on your PATH." : err.message);
    });
    child.on("close", (code) => {
      if (this.over) return;
      this.fail(`Claude Code exited unexpectedly (code ${code})`, this.stderr.trim());
    });

    child.stdin.write(userLine(prompt));
    this.beginTurn();
  }

  private onLine(stream: ClaudeStream, raw: string) {
    if (this.over) return;
    let line: ClaudeLine;
    try {
      line = JSON.parse(raw) as ClaudeLine;
    } catch {
      return; // Not one of its JSON lines.
    }
    if (this.inTurn) this.armStall();
    for (const event of stream.push(line)) {
      if (event.type === "turn_end") this.endTurn();
      if (event.type === "error") {
        // Stopped before its first message was saved: nothing to resume.
        const lost = this.start.session && event.error.message.includes("No conversation found");
        const signedOut = /invalid api key|run \/login|not logged in|authentication/i.test(event.error.message);
        const fix = "Run `claude auth login` in a terminal, then nudge this task.";
        this.finish(
          lost
            ? { type: "session_lost" }
            : signedOut
              ? { type: "error", error: { ...event.error, detail: fix } }
              : event,
        );
        return;
      }
      this.emit(event);
    }
  }

  private beginTurn() {
    this.inTurn = true;
    this.armStall();
  }

  private endTurn() {
    this.inTurn = false;
    this.clearStall();
  }

  private armStall() {
    this.clearStall();
    this.stallTimer = setTimeout(() => {
      this.fail(`No output from Claude Code for ${Math.round(this.stallMs / 60_000)} minutes`);
    }, this.stallMs);
  }

  private clearStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private fail(message: string, detail?: string) {
    this.finish({ type: "error", error: detail ? { message, detail } : { message } });
  }

  /** Reports the end of the session and shuts it down. */
  private finish(event: AgentEvent) {
    if (this.over) return;
    this.stop();
    this.emit(event);
  }

  private cleanUp() {
    this.clearStall();
    for (const { socket } of this.pending.values()) socket.destroy();
    this.pending.clear();
    this.tools?.close();
  }
}
