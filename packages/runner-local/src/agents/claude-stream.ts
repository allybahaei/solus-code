import { isAbsolute, relative } from "node:path";
import type { AgentEvent } from "./agent";

/** Our own tools. Their effects show in the UI, so they don't need a tool row. */
export const SOLUS_TOOL_PREFIX = "mcp__solus__";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const TERMINAL_LIMIT = 8000;

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

/** The fields of Claude Code's stream-json lines that Solus reads. */
export interface ClaudeLine {
  type: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  event?: {
    type: string;
    index?: number;
    message?: { id: string };
    content_block?: { type: string };
    delta?: { type: string; text?: string };
  };
  message?: { content?: ContentBlock[] | string };
  is_error?: boolean;
  result?: string;
  errors?: string[];
  permission_denials?: { tool_name: string; tool_input?: Record<string, unknown> }[];
  rate_limit_info?: { status?: string; resetsAt?: number; rateLimitType?: string };
}

/** One line for the tool row, such as a file path or a shell command. */
export function summarizeTool(name: string, input: Record<string, unknown>, cwd: string): string {
  const file = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof file === "string") {
    const rel = isAbsolute(file) ? relative(cwd, file) : file;
    return rel && !rel.startsWith("..") ? rel : file;
  }
  for (const key of ["command", "pattern", "query", "url", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string") return value.split("\n")[0]?.slice(0, 200) ?? "";
  }
  return JSON.stringify(input).slice(0, 200);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c: { text?: string }) => c.text ?? "").join("\n");
}

const forTerminal = (text: string) => {
  const cut = text.length > TERMINAL_LIMIT ? `${text.slice(0, TERMINAL_LIMIT)}\n…` : text;
  return cut.replace(/\r?\n/g, "\r\n");
};

/** Turns Claude Code's stream-json lines into agent events. One per session. */
export class ClaudeStream {
  private messageId = "";
  private openText: { index: number; id: string } | null = null;
  private readonly tools = new Map<string, ToolUse>();

  constructor(private readonly cwd: string) {}

  push(line: ClaudeLine): AgentEvent[] {
    // Subagents report through the same stream; only the main thread goes in the chat.
    if (line.parent_tool_use_id) return [];
    switch (line.type) {
      case "system":
        return line.subtype === "init" && line.session_id ? [{ type: "session", id: line.session_id }] : [];
      case "stream_event":
        return this.streamEvent(line);
      case "assistant":
        return this.assistant(line);
      case "user":
        return this.toolResults(line);
      case "result":
        return this.result(line);
      case "rate_limit_event":
        return this.rateLimit(line);
      default:
        return [];
    }
  }

  private streamEvent({ event }: ClaudeLine): AgentEvent[] {
    if (!event) return [];
    const open = this.openText;
    switch (event.type) {
      case "message_start":
        this.messageId = event.message?.id ?? "";
        return [];
      case "content_block_start":
        if (event.content_block?.type === "text" && event.index !== undefined) {
          this.openText = { index: event.index, id: `${this.messageId}-${event.index}` };
        }
        return [];
      case "content_block_delta":
        if (open && event.delta?.type === "text_delta" && open.index === event.index) {
          return [{ type: "text", id: open.id, chunk: event.delta.text ?? "", done: false }];
        }
        return [];
      case "content_block_stop":
        if (!open || open.index !== event.index) return [];
        this.openText = null;
        return [{ type: "text", id: open.id, chunk: "", done: true }];
      default:
        return [];
    }
  }

  private assistant({ message }: ClaudeLine): AgentEvent[] {
    if (!Array.isArray(message?.content)) return [];
    const events: AgentEvent[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use" || !block.id || !block.name || this.tools.has(block.id)) continue;
      const input = block.input ?? {};
      this.tools.set(block.id, { name: block.name, input });
      if (block.name.startsWith(SOLUS_TOOL_PREFIX)) continue;
      events.push({ type: "tool", tool: block.name, text: summarizeTool(block.name, input, this.cwd) });
    }
    return events;
  }

  private toolResults({ message }: ClaudeLine): AgentEvent[] {
    if (!Array.isArray(message?.content)) return [];
    const events: AgentEvent[] = [];
    let changed = false;
    for (const block of message.content) {
      const tool = block.type === "tool_result" && block.tool_use_id ? this.tools.get(block.tool_use_id) : undefined;
      if (!tool) continue;
      if (tool.name === "Bash") {
        changed = true;
        const output = resultText(block.content);
        events.push({ type: "terminal", data: forTerminal(`$ ${String(tool.input.command ?? "")}\n${output}\n`) });
      } else if (FILE_TOOLS.has(tool.name)) {
        changed = true;
      }
    }
    if (changed) events.push({ type: "files_changed" });
    return events;
  }

  private result(line: ClaudeLine): AgentEvent[] {
    const refused: AgentEvent[] = (line.permission_denials ?? []).map((d) => ({
      type: "tool",
      tool: "Refused",
      text: `${d.tool_name}: ${summarizeTool(d.tool_name, d.tool_input ?? {}, this.cwd)}`,
    }));
    if (line.is_error || line.subtype !== "success") {
      const message = line.errors?.join("; ") || line.result?.trim() || `Claude Code stopped (${line.subtype ?? "unknown error"})`;
      return [...refused, { type: "error", error: { message } }];
    }
    return [...refused, { type: "turn_end" }];
  }

  private rateLimit({ rate_limit_info: info }: ClaudeLine): AgentEvent[] {
    if (!info || info.status === "allowed") return [];
    const resets = info.resetsAt ? ` until ${new Date(info.resetsAt * 1000).toLocaleTimeString()}` : "";
    return [{ type: "terminal", data: `\x1b[33mClaude usage limit: ${info.status}${resets}\x1b[0m\r\n` }];
  }
}
