"use client";

import { getRunner, BASE_BRANCH, REPO } from "./runner";
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

export const startTask = (id: string) => attempt(() => getRunner().startTask(id));
export const stopTask = (id: string) => attempt(() => getRunner().stopTask(id));
export const sendMessage = (id: string, text: string) => attempt(() => getRunner().sendMessage(id, text));

export function mergeTask(id: string) {
  const task = useSolus.getState().tasks[id];
  if (!task) return;
  return attempt(() =>
    getRunner().merge(id, {
      targetBranch: task.baseBranch,
      commitMessage: task.title,
      strategy: "squash",
      deleteBranch: true,
    }),
  );
}

export function openPullRequest(id: string) {
  const task = useSolus.getState().tasks[id];
  if (!task) return;
  return attempt(() =>
    getRunner().openPullRequest(id, { title: task.title, body: task.prompt, baseBranch: task.baseBranch }),
  );
}

/** Creates a task from a prompt, starts it and opens its tab. */
export async function createAndStart(prompt: string) {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
  const task = await attempt(() =>
    getRunner().createTask({ repo: REPO, title, prompt: prompt.trim(), baseBranch: BASE_BRANCH }),
  );
  if (!task) return;
  useSolus.getState().open(task.id);
  await startTask(task.id);
}
