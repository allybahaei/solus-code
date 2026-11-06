import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentCheck, AgentKind, SetupCheck, SetupStatus } from "@solus/core";

const exec = promisify(execFile);
const CHECK_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** merge-tree --write-tree arrived in this version. */
const MIN_GIT: readonly [number, number] = [2, 38];

/** Executables to check. The defaults come from PATH. */
export interface SetupCommands {
  git?: string;
  gh?: string;
  claude?: string;
  codex?: string;
  opencode?: string;
  cursor?: string;
  npm?: string;
}

/**
 * Official packages Solus can install when someone clicks Install. Claude Code's
 * licence doesn't allow bundling it, so this fetches it from its maker instead.
 */
const PACKAGES: Partial<Record<AgentKind, string>> = {
  "claude-code": "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode-ai",
};

export async function installAgent(agent: AgentKind, npm = "npm"): Promise<void> {
  const name = PACKAGES[agent];
  if (!name) throw new Error(`Solus can't install ${agent}.`);
  try {
    await exec(npm, ["install", "-g", name], { timeout: INSTALL_TIMEOUT_MS });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error("npm isn't on your PATH.", { cause: err });
    const denied = /EACCES|permission denied/i.test(e.stderr ?? "");
    throw new Error(denied ? `npm can't write to its global folder. Run \`npm i -g ${name}\` yourself.` : (e.stderr?.trim() || e.message), { cause: err });
  }
}

/** Cursor's installer uses ~/.local/bin, which often isn't on PATH, and has used both names. */
export function cursorCommand(home = homedir()): string {
  if (!spawnSync("cursor-agent", ["--version"]).error) return "cursor-agent";
  const installed = join(home, ".local/bin/cursor-agent");
  return existsSync(installed) ? installed : "agent";
}

interface Run {
  /** False when the executable isn't there at all. */
  found: boolean;
  ok: boolean;
  stdout: string;
}

async function run(command: string, args: string[]): Promise<Run> {
  try {
    const { stdout } = await exec(command, args, { timeout: CHECK_TIMEOUT_MS });
    return { found: true, ok: true, stdout };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    return { found: e.code !== "ENOENT", ok: false, stdout: e.stdout ?? "" };
  }
}

export function gitIsNewEnough(versionLine: string): boolean {
  const [major = 0, minor = 0] = /(\d+)\.(\d+)/.exec(versionLine)?.slice(1).map(Number) ?? [];
  return major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
}

async function checkGit(command: string): Promise<SetupCheck> {
  const base = { id: "git", label: "Git" };
  const result = await run(command, ["--version"]);
  if (!result.found) return { ...base, state: "missing", fix: "Install git from https://git-scm.com" };
  if (!gitIsNewEnough(result.stdout)) {
    return { ...base, state: "problem", detail: `${result.stdout.trim()} is too old. Solus needs 2.38 or newer.`, fix: "Update git" };
  }
  return { ...base, state: "ready", detail: result.stdout.trim() };
}

async function checkGh(command: string): Promise<SetupCheck> {
  const base = { id: "gh", label: "GitHub CLI" };
  const why = "Needed to open pull requests. Merging locally works without it.";
  const result = await run(command, ["auth", "status"]);
  if (!result.found) return { ...base, state: "missing", detail: why, fix: "brew install gh" };
  if (!result.ok) return { ...base, state: "signed_out", detail: why, fix: "gh auth login" };
  return { ...base, state: "ready" };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How Claude Code will be billed, from `claude auth status`. */
export function describeClaudeLogin(status: { authMethod?: string; subscriptionType?: string }): string {
  if (status.subscriptionType) return `Signed in with your Claude ${capitalize(status.subscriptionType)} plan`;
  return status.authMethod === "claude.ai" ? "Signed in with your Claude account" : "Signed in with an API key, billed by usage";
}

async function checkClaude(command: string): Promise<AgentCheck> {
  const base = { id: "claude-code", agent: "claude-code", label: "Claude Code" } as const;
  if (process.env.CLAUDECODE) {
    return { ...base, state: "problem", detail: "Solus was started from inside Claude Code.", fix: "Start Solus from a normal terminal" };
  }
  const result = await run(command, ["auth", "status", "--json"]);
  if (!result.found) return { ...base, state: "missing", fix: "npm i -g @anthropic-ai/claude-code", installable: true };
  let status: { loggedIn?: boolean; authMethod?: string; subscriptionType?: string } = {};
  try {
    status = JSON.parse(result.stdout) as typeof status;
  } catch {
    // Treated as signed out below.
  }
  if (!status.loggedIn) return { ...base, state: "signed_out", fix: "claude auth login" };
  const warning = process.env.ANTHROPIC_API_KEY ? " ANTHROPIC_API_KEY is set, so it may bill the API instead." : "";
  return { ...base, state: "ready", detail: `${describeClaudeLogin(status)}.${warning}` };
}

async function checkCodex(command: string): Promise<AgentCheck> {
  const base = { id: "codex", agent: "codex", label: "Codex" } as const;
  // This only reads saved credentials, so an expired login still passes here.
  // The adapter catches that on the first run and says how to fix it.
  const result = await run(command, ["login", "status"]);
  if (!result.found) return { ...base, state: "missing", fix: "npm i -g @openai/codex", installable: true };
  if (!result.ok) return { ...base, state: "signed_out", fix: `${command} login` };
  return { ...base, state: "ready", detail: result.stdout.trim().split("\n")[0] ?? "Signed in" };
}

async function checkOpenCode(command: string): Promise<AgentCheck> {
  const base = { id: "opencode", agent: "opencode", label: "OpenCode" } as const;
  const result = await run(command, ["auth", "list"]);
  if (!result.found) return { ...base, state: "missing", fix: "npm i -g opencode-ai", installable: true };
  // Its free models work with no sign-in, so a missing provider isn't a problem.
  return { ...base, state: "ready", detail: "Billed by whichever provider you connected to OpenCode." };
}

async function checkCursor(command: string): Promise<AgentCheck> {
  const base = { id: "cursor", agent: "cursor", label: "Cursor" } as const;
  const missing = { ...base, state: "missing", fix: "curl https://cursor.com/install -fsS | bash" } as const;
  const result = await run(command, ["status"]);
  if (!result.found) return missing;
  if (/not logged in/i.test(result.stdout)) return { ...base, state: "signed_out", fix: `${command} login` };
  // `agent` is a common name, so only Cursor's own status counts.
  if (!/logged in/i.test(result.stdout)) return missing;
  const warning = process.env.CURSOR_API_KEY ? " CURSOR_API_KEY is set, so it may bill that key instead." : "";
  return { ...base, state: "ready", detail: `Signed in to Cursor.${warning}` };
}

/** Checks what Solus depends on. Uses no agent usage: everything here is local. */
export async function checkSetup(commands: SetupCommands = {}): Promise<SetupStatus> {
  const [git, gh, claude, codex, opencode, cursor] = await Promise.all([
    checkGit(commands.git ?? "git"),
    checkGh(commands.gh ?? "gh"),
    checkClaude(commands.claude ?? "claude"),
    checkCodex(commands.codex ?? "codex"),
    checkOpenCode(commands.opencode ?? "opencode"),
    checkCursor(commands.cursor ?? cursorCommand()),
  ]);
  // Cursor is optional and needs its own installer, so it only appears once it's there.
  const agents = [claude, codex, opencode, ...(cursor.state === "missing" ? [] : [cursor])];
  return { agents, tools: [git, gh] };
}
