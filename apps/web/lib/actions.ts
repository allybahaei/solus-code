"use client";

import type {
  AgentKind,
  MergeOptions,
  MergeStrategy,
  PROptions,
  PullRequestCheck,
  PullRequestComment,
  PullRequestStatus,
  TaskSource,
} from "@solus/core";
import { getRunner } from "./runner";
import { useSolus } from "./store";

/** Runs a runner call; a failure shows as a notice instead of throwing. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    useSolus.getState().setNotice(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

export async function recheckSetup() {
  const setup = await attempt(() => getRunner().checkSetup());
  if (setup) useSolus.setState({ setup });
}

/** Reads a task's pull request. Returns the status, or an error message for the view to show. */
export async function readPullRequest(id: string): Promise<PullRequestStatus | string> {
  try {
    return await getRunner().getPullRequest(id);
  } catch (err) {
    return message(err);
  }
}

export const pushPullRequest = (id: string) => attempt(() => getRunner().pushPullRequest(id));

export const mergePullRequest = (id: string, strategy: MergeStrategy) => attempt(() => getRunner().mergePullRequest(id, strategy));

/** Sends a failed check to the agent, with its log so it can work without reaching GitHub. */
export async function fixCheck(id: string, pr: number, check: PullRequestCheck) {
  const log = check.url ? await attempt(() => getRunner().getCheckLog(id, check.url ?? "")) : "";
  const parts = [`The "${check.name}" check failed on pull request #${pr}. Find the cause and fix it.`, check.url, log && `The end of its log:\n\n${log}`];
  await sendMessage(id, parts.filter(Boolean).join("\n\n"));
}

/** Sends a review comment to the agent. */
export async function fixComment(id: string, pr: number, comment: PullRequestComment) {
  const where = comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}` : "";
  await sendMessage(id, `Address this review comment from ${comment.author} on pull request #${pr}${where}:\n\n${comment.body}`);
}

export const listSources = () => attempt(() => getRunner().listSources());

/** Reads a browser file and stores it for the task. Returns its path, or undefined on failure. */
export async function attachFile(id: string, file: File): Promise<string | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return attempt(() => getRunner().attachFile(id, file.name, btoa(binary)));
}

export const startTask = (id: string) => attempt(() => getRunner().startTask(id));
export const answerApproval = (id: string, approvalId: string, allow: boolean) =>
  attempt(() => getRunner().answerApproval(id, approvalId, allow));
/** Terminal traffic is too frequent for notices; a failed keystroke just drops. */
export const writeTerminal = (id: string, data: string) => {
  getRunner().writeTerminal(id, data).catch(() => {});
};
export const resizeTerminal = (id: string, cols: number, rows: number) => {
  getRunner().resizeTerminal(id, cols, rows).catch(() => {});
};
export const resolveConflicts = (id: string, target: string) => attempt(() => getRunner().resolveConflicts(id, target));
export const startAction = (id: string, name: string) => attempt(() => getRunner().startAction(id, name));
export const stopAction = (id: string) => attempt(() => getRunner().stopAction(id));
export const archiveTask = (id: string) => attempt(() => getRunner().archiveTask(id));
export const restoreTask = (id: string) => attempt(() => getRunner().restoreTask(id));
export const deleteTask = (id: string) => attempt(() => getRunner().deleteTask(id));
export const stopTask = (id: string) => attempt(() => getRunner().stopTask(id));
export function sendMessage(id: string, text: string, agent?: AgentKind) {
  const task = useSolus.getState().tasks[id];
  if (task && agent && agent !== task.agent) {
    // Optimistic: show the new agent right away.
    useSolus.setState((s) => ({ tasks: { ...s.tasks, [id]: { ...task, agent } } }));
  }
  return attempt(() => getRunner().sendMessage(id, text, agent ? { agent } : {}));
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Merges locally. Returns an error message for the dialog to show, or null. */
export async function mergeTask(id: string, opts: MergeOptions): Promise<string | null> {
  try {
    await getRunner().merge(id, opts);
    useSolus.getState().setNotice(`Merged into ${opts.targetBranch}.`);
    return null;
  } catch (err) {
    return message(err);
  }
}

/** Opens a pull request. Returns an error message for the dialog to show, or null. */
export async function openPullRequest(id: string, opts: PROptions): Promise<string | null> {
  try {
    const { url } = await getRunner().openPullRequest(id, opts);
    useSolus.getState().setNotice(`Opened ${url}`);
    return null;
  } catch (err) {
    return message(err);
  }
}

/** Creates a task from a prompt, starts it and opens its tab. */
export async function createAndStart(prompt: string, agent: AgentKind, source?: TaskSource) {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  // A source supplies its own title.
  const title = source ? "" : firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
  const { repo } = useSolus.getState();
  if (!repo) return;
  const task = await attempt(() =>
    getRunner().createTask({
      repo: repo.name,
      title,
      prompt: prompt.trim(),
      baseBranch: repo.defaultBranch,
      agent,
      ...(source ? { source } : {}),
    }),
  );
  if (!task) return;
  useSolus.getState().open(task.id);
  await startTask(task.id);
}
