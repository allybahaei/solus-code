import { relative } from "node:path";
import type { AgentEvent } from "./agent";

const TERMINAL_LIMIT = 8000;

interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  changes?: { path: string; kind: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
}

/** The fields of `codex exec --json` lines that Solus reads. */
export interface CodexLine {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  error?: { message?: string };
}

/** Codex wraps commands as: /bin/zsh -lc "..."; show what it actually ran. */
export function unwrapCommand(command: string): string {
  const match = /^\S+ -lc (['"])([\s\S]*)\1$/.exec(command);
  return match?.[2] ?? command;
}

const forTerminal = (text: string) => {
  const cut = text.length > TERMINAL_LIMIT ? `${text.slice(0, TERMINAL_LIMIT)}\n…` : text;
  return cut.replace(/\r?\n/g, "\r\n");
};

/** Turns one Codex turn's JSONL into agent events. */
export class CodexStream {
  /** Set once the turn has finished, whichever way. */
  finished = false;

  /** `turn` keeps message ids unique, because Codex's item ids restart each turn. */
  constructor(
    private readonly cwd: string,
    private readonly turn: number,
  ) {}

  push(line: CodexLine): AgentEvent[] {
    switch (line.type) {
      case "thread.started":
        return line.thread_id ? [{ type: "session", id: line.thread_id }] : [];
      case "item.started":
        return line.item ? this.started(line.item) : [];
      case "item.completed":
        return line.item ? this.completed(line.item) : [];
      case "turn.completed":
        this.finished = true;
        return [];
      case "turn.failed":
        this.finished = true;
        return [{ type: "error", error: { message: line.error?.message ?? "Codex stopped with an error." } }];
      default:
        // "error" lines repeat what turn.failed says, or are retries Codex recovers from.
        return [];
    }
  }

  private started(item: CodexItem): AgentEvent[] {
    if (item.type === "command_execution") {
      return [{ type: "tool", tool: "Bash", text: unwrapCommand(item.command ?? "").split("\n")[0] ?? "" }];
    }
    if (item.type === "mcp_tool_call" && item.server !== "solus") {
      return [{ type: "tool", tool: `${item.server}.${item.tool}`, text: JSON.stringify(item.arguments ?? {}).slice(0, 200) }];
    }
    return [];
  }

  private completed(item: CodexItem): AgentEvent[] {
    switch (item.type) {
      case "agent_message":
        return [{ type: "text", id: `${this.turn}-${item.id}`, chunk: item.text ?? "", done: true }];
      case "command_execution": {
        const failed = item.exit_code ? `(exit ${item.exit_code})\n` : "";
        const data = forTerminal(`$ ${unwrapCommand(item.command ?? "")}\n${item.aggregated_output ?? ""}${failed}`);
        return [{ type: "terminal", data }, { type: "files_changed" }];
      }
      case "file_change": {
        const paths = (item.changes ?? []).map((c) => relative(this.cwd, c.path) || c.path);
        return [{ type: "tool", tool: "Edit", text: paths.join(", ") }, { type: "files_changed" }];
      }
      default:
        return [];
    }
  }
}
