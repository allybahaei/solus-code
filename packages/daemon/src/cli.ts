import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import type { AgentKind } from "@solus/core";
import { ClaudeCodeAdapter, CodexAdapter, FakeAgent, LocalRunner, UnavailableAgent, type AgentAdapter } from "@solus/runner-local";
import { createMockRunner } from "@solus/runner-mock";
import { startDaemon } from "./server";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4317" },
    /** A real repo. Without it the daemon serves the mock. */
    repo: { type: "string" },
    /** Use the fake agent, which edits files with no model. */
    fake: { type: "boolean", default: false },
    autopilot: { type: "boolean", default: false },
    speed: { type: "string", default: "1" },
  },
});

const token = process.env.SOLUS_TOKEN ?? randomBytes(24).toString("hex");
// Shells and agents inherit this environment and have no use for the token.
delete process.env.SOLUS_TOKEN;
delete process.env.NEXT_PUBLIC_SOLUS_TOKEN;

const LABELS: Record<AgentKind, string> = { "claude-code": "Claude Code", claude: "Claude", codex: "Codex", gemini: "Gemini" };

function adapterFor(agent: AgentKind): AgentAdapter {
  if (values.fake) return new FakeAgent();
  if (agent === "claude-code") return new ClaudeCodeAdapter();
  if (agent === "codex") return new CodexAdapter();
  return new UnavailableAgent(LABELS[agent]);
}

try {
  const runner = values.repo
    ? await LocalRunner.open({
        repoPath: values.repo,
        adapterFor,
        ...(process.env.SOLUS_HOME ? { home: process.env.SOLUS_HOME } : {}),
      })
    : createMockRunner({ autopilot: values.autopilot, speed: Number(values.speed) || 1 });

  const daemon = await startDaemon({ runner, token, port: Number(values.port) });
  console.log(`Solus daemon on 127.0.0.1:${daemon.port} (${values.repo ? `${values.repo}${values.fake ? ", fake agent" : ""}` : "mock runner"})`);

  const stop = () => {
    runner.dispose();
    void daemon.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  const inUse = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
  console.error(inUse ? `Port ${values.port} is already in use. Is another Solus daemon running?` : (err as Error).message);
  process.exit(1);
}
