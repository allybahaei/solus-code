import type { AgentKind } from "@solus/core";
import { cursorCommand } from "../setup";
import { cursorAdapter, openCodeAdapter } from "./acp";
import type { AgentAdapter } from "./agent";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { UnavailableAgent } from "./unavailable";

/** The real agent for each kind, each run from the user's own install. */
export function adapterFor(agent: AgentKind): AgentAdapter {
  if (agent === "claude-code") return new ClaudeCodeAdapter();
  if (agent === "codex") return new CodexAdapter();
  if (agent === "opencode") return openCodeAdapter();
  if (agent === "cursor") return cursorAdapter(cursorCommand());
  return new UnavailableAgent(agent);
}
