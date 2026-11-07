import { relative } from "node:path";
import type { AgentEvent } from "./agent";

const TERMINAL_LIMIT = 8000;

interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  status?: string;
  changes?: { path: string; kind: unknown }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
}

/** The fields of `codex app-server` notifications that Solus reads. */
export interface CodexNotification {
  method: string;
  params?: {
    item?: CodexItem;
    itemId?: string;
    delta?: string;
    turn?: { status: string; error?: { message: string } | null };
  };
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

/** Turns `codex app-server` notifications into agent events. One per session. */
export class CodexStream {
  /** Messages that arrived in pieces, so their last item isn't repeated. */
  private readonly streamed = new Set<string>();

  constructor(private readonly cwd: string) {}

  push({ method, params }: CodexNotification): AgentEvent[] {
    switch (method) {
      case "item/agentMessage/delta":
        if (!params?.itemId) return [];
        this.streamed.add(params.itemId);
        return [{ type: "text", id: params.itemId, chunk: params.delta ?? "", done: false }];
      case "item/started":
        return params?.item ? this.started(params.item) : [];
      case "item/completed":
        return params?.item ? this.completed(params.item) : [];
      case "turn/completed":
        return this.turnCompleted(params?.turn);
      default:
        // "error" notifications repeat what turn/completed says, or are retries Codex recovers from.
        return [];
    }
  }

  private started(item: CodexItem): AgentEvent[] {
    if (item.type === "commandExecution") {
      return [{ type: "tool", tool: "Bash", text: unwrapCommand(item.command ?? "").split("\n")[0] ?? "" }];
    }
    if (item.type === "mcpToolCall" && item.server !== "solus") {
      return [{ type: "tool", tool: `${item.server}.${item.tool}`, text: JSON.stringify(item.arguments ?? {}).slice(0, 200) }];
    }
    return [];
  }

  private completed(item: CodexItem): AgentEvent[] {
    switch (item.type) {
      case "agentMessage": {
        const chunk = this.streamed.delete(item.id) ? "" : (item.text ?? "");
        return [{ type: "text", id: item.id, chunk, done: true }];
      }
      case "commandExecution": {
        const failed = item.exitCode ? `(exit ${item.exitCode})\n` : "";
        const data = forTerminal(`$ ${unwrapCommand(item.command ?? "")}\n${item.aggregatedOutput ?? ""}${failed}`);
        return [{ type: "terminal", data }, { type: "files_changed" }];
      }
      case "fileChange": {
        if (item.status !== "completed") return [];
        const paths = (item.changes ?? []).map((c) => relative(this.cwd, c.path) || c.path);
        return [{ type: "tool", tool: "Edit", text: paths.join(", ") }, { type: "files_changed" }];
      }
      default:
        return [];
    }
  }

  private turnCompleted(turn: NonNullable<CodexNotification["params"]>["turn"]): AgentEvent[] {
    if (turn?.status === "completed") return [{ type: "turn_end" }];
    if (turn?.status === "failed") {
      return [{ type: "error", error: { message: turn.error?.message ?? "Codex stopped with an error." } }];
    }
    return []; // Interrupted: Solus stopped it.
  }
}
