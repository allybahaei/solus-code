import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { branchExists, git } from "./git";

/** Optional solus.json at the repo root. */
export interface RepoConfig {
  /** Shell command run in each new worktree, such as "pnpm install". */
  setup?: string;
  /** Files git doesn't track that a worktree needs, such as ".env.local". */
  copy?: string[];
}

export function readRepoConfig(root: string): RepoConfig {
  const path = join(root, "solus.json");
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error("solus.json isn't valid JSON.", { cause: err });
  }
  const { setup, copy } = raw as RepoConfig;
  return {
    ...(typeof setup === "string" ? { setup } : {}),
    ...(Array.isArray(copy) ? { copy: copy.filter((c) => typeof c === "string") } : {}),
  };
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .replace(/-$/, "") || "task"
  );
}

/** A solus/<slug> branch name that no branch or other task uses yet. */
export async function uniqueBranch(root: string, title: string, taken: ReadonlySet<string>): Promise<string> {
  const base = `solus/${slugify(title)}`;
  for (let n = 1; ; n++) {
    const branch = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(branch) && !(await branchExists(root, branch))) return branch;
  }
}

export async function createWorktree(root: string, path: string, branch: string, baseBranch: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await git(root, ["worktree", "add", "-b", branch, path, baseBranch]);
}

/** Copies the configured files in, refusing any path that leaves the repo. */
export function copyFiles(root: string, worktree: string, files: readonly string[]): string[] {
  const copied: string[] = [];
  for (const file of files) {
    const rel = relative(root, join(root, file));
    if (isAbsolute(file) || rel.startsWith("..")) {
      throw new Error(`solus.json can only copy files inside the repo: ${file}`);
    }
    if (!existsSync(join(root, rel))) continue;
    mkdirSync(dirname(join(worktree, rel)), { recursive: true });
    cpSync(join(root, rel), join(worktree, rel), { recursive: true });
    copied.push(rel);
  }
  return copied;
}

/** Runs the setup command, streaming output. Rejects if it fails. */
export function runSetup(
  command: string,
  cwd: string,
  onOutput: (data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, signal, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const out = (d: Buffer) => {
      const text = d.toString();
      tail = (tail + text).slice(-2000);
      onOutput(text.replace(/\r?\n/g, "\r\n"));
    };
    child.stdout.on("data", out);
    child.stderr.on("data", out);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new SetupError(`Setup failed: ${command} (exit ${code})`, tail.trim()));
    });
  });
}

export class SetupError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "SetupError";
  }
}
