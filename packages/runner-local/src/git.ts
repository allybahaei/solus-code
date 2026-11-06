import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { RepoInfo } from "@solus/core";

const exec = promisify(execFile);

interface ExecError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

/** Runs git and returns stdout. Exit codes in `okCodes` count as success. */
export async function git(cwd: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      // Never stop to ask for credentials: nobody is there to answer.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return stdout;
  } catch (err) {
    const e = err as ExecError;
    if (typeof e.code === "number" && okCodes.includes(e.code)) return e.stdout ?? "";
    throw new Error(`git ${args[0]} failed: ${(e.stderr ?? e.message).trim()}`, { cause: err });
  }
}

/** owner/name from a GitHub-style remote URL, or null. */
export function nameFromRemote(url: string): string | null {
  return /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;
}

async function defaultBranch(root: string): Promise<string> {
  const head = await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], [0, 1, 128]);
  const remote = head.trim().replace(/^origin\//, "");
  if (remote && (await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${remote}`], [0, 1])).trim()) {
    return remote;
  }
  return (await git(root, ["branch", "--show-current"])).trim() || "main";
}

/** Checks the path is a usable repo and describes it. */
export async function readRepo(path: string): Promise<RepoInfo> {
  let root: string;
  try {
    root = (await git(path, ["rev-parse", "--show-toplevel"])).trim();
  } catch (err) {
    throw new Error(`Not a git repository: ${path}`, { cause: err });
  }
  if (!(await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1])).trim()) {
    throw new Error(`This repository has no commits yet: ${root}`);
  }
  const remote = await git(root, ["remote", "get-url", "origin"], [0, 2, 128]);
  return {
    name: nameFromRemote(remote) ?? basename(root),
    path: root,
    defaultBranch: await defaultBranch(root),
    actions: [],
  };
}

export async function branchExists(root: string, branch: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], [0, 1])).trim() !== "";
}
