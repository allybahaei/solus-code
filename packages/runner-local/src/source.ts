import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestRef, TaskSource, TaskSources } from "@solus/core";
import { branchExists, git } from "./git";

const exec = promisify(execFile);

export async function ghJson<T>(gh: string, cwd: string, args: string[]): Promise<T> {
  try {
    const { stdout } = await exec(gh, args, { cwd, timeout: 20_000 });
    return JSON.parse(stdout) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error("The GitHub CLI isn't installed, or `gh` isn't on your PATH.", { cause: err });
    throw new Error(e.stderr?.trim() || e.message, { cause: err });
  }
}

/** What a task could start from. GitHub lists come back empty if gh can't reach them. */
export async function listSources(root: string, gh: string, defaultBranch: string): Promise<TaskSources> {
  const list = <T>(args: string[]) => ghJson<T[]>(gh, root, args).catch(() => [] as T[]);
  const [refs, pullRequests, issues] = await Promise.all([
    git(root, ["for-each-ref", "--format=%(refname:short)", "--sort=-committerdate", "refs/heads"]),
    list<{ number: number; title: string }>(["pr", "list", "--limit", "30", "--json", "number,title"]),
    list<{ number: number; title: string }>(["issue", "list", "--limit", "30", "--json", "number,title"]),
  ]);
  const branches = refs.split("\n").filter((b) => b && b !== defaultBranch && !b.startsWith("solus/"));
  return { branches, pullRequests, issues };
}

export interface ResolvedSource {
  title: string;
  prompt: string;
  /** Set when the task uses this branch rather than making a new one. */
  branch?: string;
  /** The branch for a new task to start from, when it isn't the repo's default. */
  baseBranch?: string;
  pullRequest?: PullRequestRef;
}

/** Turns a source into what a task needs. Fetches a pull request's branch if it has to. */
export async function resolveSource(root: string, gh: string, source: TaskSource, defaultBranch: string): Promise<ResolvedSource> {
  switch (source.type) {
    case "branch": {
      if (source.branch === defaultBranch) throw new Error(`Tasks can't work directly on ${defaultBranch}. Start a new task instead.`);
      if (!(await branchExists(root, source.branch))) throw new Error(`Branch ${source.branch} doesn't exist.`);
      return { title: `Work on ${source.branch}`, prompt: `Continue the work on the branch ${source.branch}.`, branch: source.branch };
    }
    case "pr": {
      const pr = await ghJson<{ title: string; body: string; baseRefName: string; headRefName: string; isCrossRepository: boolean; url: string }>(gh, root, [
        "pr", "view", String(source.number), "--json", "title,body,baseRefName,headRefName,isCrossRepository,url",
      ]);
      const branch = `solus/pr-${source.number}`;
      if (await branchExists(root, branch)) throw new Error(`There's already a task or branch for PR #${source.number}.`);
      await git(root, ["fetch", "origin", `pull/${source.number}/head:refs/heads/${branch}`]);
      return {
        title: `PR #${source.number}: ${pr.title}`,
        prompt: `You're picking up pull request #${source.number}: ${pr.title}\n${pr.url}\n\n${pr.body}`.trim(),
        branch,
        baseBranch: pr.baseRefName,
        pullRequest: {
          url: pr.url,
          number: source.number,
          head: pr.headRefName,
          ...(pr.isCrossRepository ? { fork: true } : {}),
        },
      };
    }
    case "issue": {
      const issue = await ghJson<{ title: string; body: string; url: string }>(gh, root, [
        "issue", "view", String(source.number), "--json", "title,body,url",
      ]);
      return {
        title: `#${source.number}: ${issue.title}`,
        prompt: `Fix issue #${source.number}: ${issue.title}\n${issue.url}\n\n${issue.body}`.trim(),
      };
    }
  }
}

