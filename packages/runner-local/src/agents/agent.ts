import type { TaskError } from "@solus/core";

/** What an agent reports. Each adapter turns its tool's output into these. */
export type AgentEvent =
  /** Part of the agent's reply. Chunks with the same id form one message. */
  | { type: "text"; id: string; chunk: string; done: boolean }
  | { type: "tool"; tool: string; text: string }
  | { type: "terminal"; data: string }
  /** Files in the worktree may have changed. */
  | { type: "files_changed" }
  /** The agent needs the user. Their reply arrives through send(). */
  | { type: "ask"; question: string }
  /** The agent finished its turn. */
  | { type: "turn_end" }
  /** The agent can't continue. The session is over. */
  | { type: "error"; error: TaskError };

export interface AgentStart {
  taskId: string;
  /** The task's worktree. */
  cwd: string;
  /** The first message for this session. */
  prompt: string;
  /** True when continuing an earlier session rather than starting fresh. */
  resume: boolean;
}

/** One running conversation with an agent. */
export interface AgentSession {
  send(message: string): void;
  stop(): void;
}

export interface AgentAdapter {
  start(options: AgentStart, emit: (event: AgentEvent) => void): AgentSession;
}
