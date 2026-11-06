import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MergeStrategy, PullRequestCheck, PullRequestComment, PullRequestStatus } from "@solus/core";
import { ghJson } from "./source";

const exec = promisify(execFile);

/** Enough of a failed run to find the cause, without flooding the agent. */
const LOG_LINES = 200;

interface RollupItem {
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

/** gh reports GitHub Actions runs and older commit statuses in different shapes. */
function toCheck(item: RollupItem): PullRequestCheck {
  const result = (item.conclusion || item.state || "").toUpperCase();
  const finished = item.status ? item.status.toUpperCase() === "COMPLETED" : !["PENDING", "EXPECTED", ""].includes(result);
  const state = !finished
    ? "pending"
    : ["SUCCESS", "NEUTRAL"].includes(result)
      ? "passed"
      : result === "SKIPPED"
        ? "skipped"
        : "failed";
  const url = item.detailsUrl || item.targetUrl;
  return { name: item.name || item.context || "Check", state, ...(url ? { url } : {}) };
}

interface Author {
  login?: string;
}

interface PullRequestView {
  state: string;
  mergeable: string;
  reviewDecision: string;
  statusCheckRollup: RollupItem[] | null;
  comments: { id: string; author: Author | null; body: string; url: string }[];
  reviews: { id: string; author: Author | null; body: string; url?: string }[];
}

interface InlineComment {
  id: number;
  user: Author | null;
  body: string;
  path: string;
  line: number | null;
  html_url: string;
}

export async function readPullRequest(root: string, gh: string, number: number): Promise<PullRequestStatus> {
  const [pr, inline] = await Promise.all([
    ghJson<PullRequestView>(gh, root, [
      "pr", "view", String(number), "--json", "state,mergeable,reviewDecision,statusCheckRollup,comments,reviews",
    ]),
    // gh fills in {owner} and {repo} from the checkout.
    ghJson<InlineComment[]>(gh, root, ["api", `repos/{owner}/{repo}/pulls/${number}/comments`]),
  ]);
  const author = (a: Author | null) => a?.login ?? "ghost";
  const comments: PullRequestComment[] = [
    ...pr.comments.map((c) => ({ id: c.id, author: author(c.author), body: c.body, url: c.url })),
    // A review with no summary is only a wrapper around its inline comments.
    ...pr.reviews
      .filter((r) => r.body.trim())
      .map((r) => ({ id: r.id, author: author(r.author), body: r.body, ...(r.url ? { url: r.url } : {}) })),
    ...inline.map((c) => ({
      id: String(c.id),
      author: author(c.user),
      body: c.body,
      path: c.path,
      ...(c.line ? { line: c.line } : {}),
      url: c.html_url,
    })),
  ];
  return {
    state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
    conflicts: pr.mergeable === "CONFLICTING",
    ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
    checks: (pr.statusCheckRollup ?? []).map(toCheck),
    comments,
  };
}

/** The end of a failed GitHub Actions run's log. Empty for checks that run elsewhere. */
export async function readCheckLog(root: string, gh: string, url: string): Promise<string> {
  const run = /\/actions\/runs\/(\d+)/.exec(url)?.[1];
  if (!run) return "";
  try {
    const { stdout } = await exec(gh, ["run", "view", run, "--log-failed"], { cwd: root, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trimEnd().split("\n").slice(-LOG_LINES).join("\n");
  } catch {
    // The agent still gets the link. Logs expire, and may need more access.
    return "";
  }
}

export async function mergePullRequest(root: string, gh: string, number: number, strategy: MergeStrategy): Promise<void> {
  try {
    await exec(gh, ["pr", "merge", String(number), `--${strategy}`], { cwd: root, timeout: 60_000 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error("The GitHub CLI isn't installed, or `gh` isn't on your PATH.", { cause: err });
    throw new Error(e.stderr?.trim() || e.message, { cause: err });
  }
}
