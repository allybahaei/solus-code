import type { TaskError } from "@solus/core";

/** What an agent reports. Each adapter turns its tool's output into these. */
export type AgentEvent =
  /** Part of the agent's reply. Chunks with the same id form one message. */
  | { type: "text"; id: string; chunk: string; done: boolean }
  | { type: "tool"; tool: string; text: string }
  | { type: "terminal"; data: string }
  /** Files in the worktree may have changed. */
  | { type: "files_changed" }
  /** The agent's id for this conversation, to resume it later. */
  | { type: "session"; id: string }
  /** The session to resume doesn't exist, so it needs a fresh start. The session is over. */
  | { type: "session_lost" }
  /** The agent has a question. The reply arrives through send(). */
  | { type: "ask"; question: string }
  /** The agent wants to run something and is waiting for approve() or send(). */
  | { type: "approval"; id: string; tool: string; summary: string }
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
  /** The session to continue. Absent when starting fresh. */
  session?: string;
}

/** One running conversation with an agent. */
export interface AgentSession {
  /** A message from the user. With an approval pending, it denies with that reason. */
  send(message: string): void;
  approve(id: string, allow: boolean): void;
  stop(): void;
}

export interface AgentAdapter {
  start(options: AgentStart, emit: (event: AgentEvent) => void): AgentSession;
}
