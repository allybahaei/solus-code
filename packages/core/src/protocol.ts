import type { RunnerEvent } from "./events";
import type { Runner } from "./runner";

/**
 * The wire format between a browser and the daemon: JSON over one WebSocket.
 * The client calls Runner methods; the server answers and pushes every event.
 */

/** Runner methods callable over the wire. Anything else is refused. */
export const RUNNER_METHODS = [
  "snapshot",
  "checkSetup",
  "listTasks",
  "getMessages",
  "createTask",
  "startTask",
  "sendMessage",
  "answerApproval",
  "stopTask",
  "deleteTask",
  "writeTerminal",
  "resizeTerminal",
  "getDiff",
  "merge",
  "openPullRequest",
] as const satisfies readonly (keyof Runner)[];

export type RunnerMethod = (typeof RUNNER_METHODS)[number];

export interface CallMessage {
  type: "call";
  id: number;
  method: RunnerMethod;
  params: unknown[];
}

export type ServerMessage =
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; message: string }
  | { type: "event"; event: RunnerEvent };

export function isRunnerMethod(value: unknown): value is RunnerMethod {
  return typeof value === "string" && (RUNNER_METHODS as readonly string[]).includes(value);
}
