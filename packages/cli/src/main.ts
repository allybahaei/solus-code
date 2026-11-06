import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { AgentKind } from "@solus/core";
import { startDaemon, type Daemon } from "@solus/daemon";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  LocalRunner,
  UnavailableAgent,
  cursorAdapter,
  cursorCommand,
  openCodeAdapter,
  type AgentAdapter,
} from "@solus/runner-local";

declare const __SOLUS_VERSION__: string;

const FIRST_PORT = 4317;
const PORTS_TO_TRY = 20;

const HELP = `Solus: run coding agents in parallel, each in its own git worktree.

Usage: solus-code [repo] [options]

  repo          The git repo to work on. Defaults to this folder.
  --port <n>    Port to use. Defaults to the first free one from ${FIRST_PORT}.
  --no-open     Don't open the browser.
  --version     Show the version.
  --help        Show this help.

Agents run on your own Claude Code, Codex, OpenCode and Cursor logins.
`;

/** Your own `codex` if you have one, otherwise the copy that ships with Solus. */
function findCodex(): string | undefined {
  if (!spawnSync("codex", ["--version"]).error) return undefined;
  try {
    return createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js");
  } catch {
    return undefined;
  }
}

const codex = findCodex();

function adapterFor(agent: AgentKind): AgentAdapter {
  if (agent === "claude-code") return new ClaudeCodeAdapter();
  if (agent === "codex") return new CodexAdapter(codex ? { command: codex } : {});
  if (agent === "opencode") return openCodeAdapter();
  if (agent === "cursor") return cursorAdapter(cursorCommand());
  return new UnavailableAgent(agent);
}

/** Tries ports in turn, so two repos can run at once. */
async function listen(start: (port: number) => Promise<Daemon>, port: number | undefined): Promise<Daemon> {
  if (port !== undefined) return start(port);
  for (let p = FIRST_PORT; p < FIRST_PORT + PORTS_TO_TRY; p++) {
    try {
      return await start(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(`No free port from ${FIRST_PORT} to ${FIRST_PORT + PORTS_TO_TRY - 1}. Choose one with --port.`);
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => {}); // The link is printed anyway.
  child.unref();
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
    },
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${__SOLUS_VERSION__}\n`);

  const repoPath = resolve(positionals[0] ?? process.cwd());
  const home = process.env.SOLUS_HOME;
  const runner = await LocalRunner.open({ repoPath, adapterFor, commands: codex ? { codex } : {}, ...(home ? { home } : {}) });

  const token = randomBytes(24).toString("hex");
  const staticDir = fileURLToPath(new URL("../web", import.meta.url));
  const port = values.port ? Number(values.port) : undefined;
  const daemon = await listen((p) => startDaemon({ runner, token, port: p, staticDir }), port);

  const url = `http://127.0.0.1:${daemon.port}/#token=${token}`;
  const { repo } = await runner.snapshot();
  process.stdout.write(`\nSolus is running on ${repo.name}\n\n  ${url}\n\nPress Ctrl-C to stop.\n`);
  if (!values["no-open"]) openBrowser(url);

  const stop = () => {
    runner.dispose();
    void daemon.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
