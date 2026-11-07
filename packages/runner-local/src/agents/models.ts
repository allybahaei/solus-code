import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentKind, ModelOption } from "@solus/core";

const TIMEOUT_MS = 10_000;

const CLAUDE_MODELS: ModelOption[] = [
  { id: "opus", label: "Opus", efforts: ["low", "medium", "high"] },
  { id: "sonnet", label: "Sonnet", efforts: ["low", "medium", "high"] },
  { id: "haiku", label: "Haiku", efforts: [] },
];

interface CodexModel {
  id: string;
  displayName?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string }[];
}

/** Asks Codex itself, so the list always matches the user's own install and plan. */
function codexModels(command: string): Promise<ModelOption[]> {
  return new Promise((resolve) => {
    const child = spawn(command, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
    const done = (models: ModelOption[]) => {
      clearTimeout(timer);
      child.kill();
      resolve(models);
    };
    const timer = setTimeout(() => done([]), TIMEOUT_MS);
    child.on("error", () => done([]));
    child.stdin.on("error", () => {});
    const write = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    createInterface({ input: child.stdout }).on("line", (raw) => {
      try {
        const line = JSON.parse(raw) as { id?: number; result?: { data?: CodexModel[] } };
        if (line.id === 1) {
          write({ method: "initialized" });
          write({ id: 2, method: "model/list", params: {} });
        }
        if (line.id === 2) {
          done(
            (line.result?.data ?? [])
              .filter((m) => !m.hidden)
              .map((m) => ({
                id: m.id,
                label: m.displayName ?? m.id,
                efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
              })),
          );
        }
      } catch {
        // Not a line Solus reads.
      }
    });
    write({ id: 1, method: "initialize", params: { clientInfo: { name: "solus", version: "0.1.0" }, capabilities: null } });
  });
}

/** Models the agent can run. Empty means Solus can't choose one for it. */
export function listModels(agent: AgentKind, codex = "codex"): Promise<ModelOption[]> {
  if (agent === "claude-code") return Promise.resolve(CLAUDE_MODELS);
  if (agent === "codex") return codexModels(codex);
  return Promise.resolve([]);
}
