import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentCheck, SetupCheck, SetupStatus } from "@solus/core";

const exec = promisify(execFile);
const CHECK_TIMEOUT_MS = 15_000;

/** merge-tree --write-tree arrived in this version. */
const MIN_GIT: readonly [number, number] = [2, 38];

/** Executables to check. The defaults come from PATH. */
export interface SetupCommands {
  git?: string;
  gh?: string;
  claude?: string;
  codex?: string;
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
  if (!result.found) return { ...base, state: "missing", fix: "npm i -g @anthropic-ai/claude-code" };
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
  if (!result.found) return { ...base, state: "missing", fix: "npm i -g @openai/codex" };
  if (!result.ok) return { ...base, state: "signed_out", fix: "codex login" };
  return { ...base, state: "ready", detail: result.stdout.trim().split("\n")[0] ?? "Signed in" };
}

/** Checks what Solus depends on. Uses no agent usage: everything here is local. */
export async function checkSetup(commands: SetupCommands = {}): Promise<SetupStatus> {
  const [git, gh, claude, codex] = await Promise.all([
    checkGit(commands.git ?? "git"),
    checkGh(commands.gh ?? "gh"),
    checkClaude(commands.claude ?? "claude"),
    checkCodex(commands.codex ?? "codex"),
  ]);
  return { agents: [claude, codex], tools: [git, gh] };
}
