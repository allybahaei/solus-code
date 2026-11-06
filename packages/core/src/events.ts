import type { TaskState } from "./state";
import type { ChangeStats, Task, Timestamp } from "./task";

/** Who produced a piece of agent conversation. */
export type MessageRole = "user" | "agent" | "tool";

/** A complete message in a task's conversation. */
export interface AgentMessage {
  id: string;
  taskId: string;
  role: MessageRole;
  text: string;
  at: Timestamp;
  /** For tool messages: which tool ran, such as "Edit" or "Bash". */
  tool?: string;
  /** The chat it belongs to. Absent for the main chat. */
  chatId?: string;
}

interface BaseEvent {
  taskId: string;
  at: Timestamp;
}

export interface TaskCreatedEvent extends BaseEvent {
  type: "task.created";
  task: Task;
}

export interface TaskDeletedEvent extends BaseEvent {
  type: "task.deleted";
}

/** The task changed without changing state. Carries the full task. */
export interface TaskUpdatedEvent extends BaseEvent {
  type: "task.updated";
  task: Task;
}

/** Output from a saved command, such as a dev server. */
export interface RunOutputEvent extends BaseEvent {
  type: "run.output";
  data: string;
}

/** Carries the full task after the change, so listeners can replace their copy. */
export interface TaskStateChangedEvent extends BaseEvent {
  type: "task.state_changed";
  from: TaskState;
  to: TaskState;
  task: Task;
}

/**
 * A chunk of agent conversation. Chunks with the same messageId append to one
 * message; `done` marks its last chunk.
 */
export interface AgentOutputEvent extends BaseEvent {
  type: "agent.output";
  messageId: string;
  role: MessageRole;
  chunk: string;
  done: boolean;
  tool?: string;
  chatId?: string;
}

/** Raw terminal bytes from the task's workspace, ANSI escapes included. */
export interface TerminalOutputEvent extends BaseEvent {
  type: "terminal.output";
  data: string;
}

/** The task's diff changed; call Runner.getDiff for the files. */
export interface DiffUpdatedEvent extends BaseEvent {
  type: "diff.updated";
  changes: ChangeStats;
}

/** Something went wrong in the runner itself (not the agent getting stuck). */
export interface RunnerErrorEvent {
  type: "error";
  taskId?: string;
  at: Timestamp;
  message: string;
}

export type RunnerEvent =
  | TaskCreatedEvent
  | TaskDeletedEvent
  | TaskUpdatedEvent
  | RunOutputEvent
  | TaskStateChangedEvent
  | AgentOutputEvent
  | TerminalOutputEvent
  | DiffUpdatedEvent
  | RunnerErrorEvent;

export type RunnerEventType = RunnerEvent["type"];
