"use client";

import type { AgentKind, MergeOptions, PROptions } from "@solus/core";
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
export async function createAndStart(prompt: string, agent: AgentKind) {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
  const { repo } = useSolus.getState();
  if (!repo) return;
  const task = await attempt(() =>
    getRunner().createTask({ repo: repo.name, title, prompt: prompt.trim(), baseBranch: repo.defaultBranch, agent }),
  );
  if (!task) return;
  useSolus.getState().open(task.id);
  await startTask(task.id);
}
