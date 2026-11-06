import type { AgentAdapter, AgentEvent, AgentSession, AgentStart } from "./agent";

/** For an agent with no adapter yet: says so instead of pretending. */
export class UnavailableAgent implements AgentAdapter {
  constructor(private readonly label: string) {}

  start(_start: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    queueMicrotask(() => emit({ type: "error", error: { message: `${this.label} isn't connected to Solus yet.` } }));
    return { send() {}, approve() {}, stop() {} };
  }
}
