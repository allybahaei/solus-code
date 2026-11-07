"use client";

import {
  MAIN_CHAT,
  type AgentKind,
  type ChatOptions,
  type MergeOptions,
  type MergeStrategy,
  type PROptions,
  type PullRequestCheck,
  type PullRequestComment,
  type PullRequestStatus,
  type Settings,
  type TaskSource,
} from "@solus/core";
import { useReview } from "@/lib/review-store";
import { getRunner } from "./runner";
import { activeChatId, useSolus, type PullRequestHealth } from "./store";

/** Runs a runner call; a failure shows as a notice instead of throwing. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    useSolus.getState().setNotice(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/** Installs an agent's official package. Takes a while, so the button shows progress. */
export async function installAgent(agent: AgentKind) {
  const setup = await attempt(() => getRunner().installAgent(agent));
  if (setup) useSolus.setState({ setup });
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

/** Checks every open pull request, for the sidebar. GitHub is slow, so this runs in the background. */
export async function refreshPullRequests() {
  const { tasks } = useSolus.getState();
  const open = Object.values(tasks).filter((t) => t.pullRequest && t.state !== "merged" && !t.archivedAt);
  for (const task of open) {
    const status = await readPullRequest(task.id);
    if (typeof status === "string") continue;
    const states = status.checks.map((c) => c.state);
    const health: PullRequestHealth = status.conflicts
      ? "conflict"
      : states.includes("failed")
        ? "failed"
        : states.includes("pending")
          ? "pending"
          : "passed";
    useSolus.setState((s) => ({ prHealth: { ...s.prHealth, [task.id]: health } }));
  }
}

export const pushPullRequest = (id: string) => attempt(() => getRunner().pushPullRequest(id));

export const mergePullRequest = (id: string, strategy: MergeStrategy) => attempt(() => getRunner().mergePullRequest(id, strategy));

/** Sends a failed check to the agent, with its log so it can work without reaching GitHub. */
export async function fixCheck(id: string, pr: number, check: PullRequestCheck) {
  const log = check.url ? await attempt(() => getRunner().getCheckLog(id, check.url ?? "")) : "";
  const parts = [`The "${check.name}" check failed on pull request #${pr}. Find the cause and fix it.`, check.url, log && `The end of its log:\n\n${log}`];
  useReview.getState().setView(id, "chat");
  await sendMessage(id, parts.filter(Boolean).join("\n\n"));
}

/** Sends a review comment to the agent. */
export async function fixComment(id: string, pr: number, comment: PullRequestComment) {
  const where = comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}` : "";
  useReview.getState().setView(id, "chat");
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

/** Asks once: installed apps don't change while the app is open. */
export async function loadOpenTargets() {
  if (useSolus.getState().openTargets) return;
  const openTargets = await attempt(() => getRunner().listOpenTargets());
  if (openTargets) useSolus.setState({ openTargets });
}

export const openWorkspace = (id: string, target: string) => attempt(() => getRunner().openWorkspace(id, target));

/** Opens the task in the chosen editor, or the first one found. */
export async function openInEditor(id: string) {
  await loadOpenTargets();
  const { openTargets, settings } = useSolus.getState();
  const target = openTargets?.find((t) => t.id === settings.editor) ?? openTargets?.find((t) => t.kind === "editor") ?? openTargets?.[0];
  if (target) await openWorkspace(id, target.id);
}

export const readFile = (id: string, path: string) => attempt(() => getRunner().readFile(id, path));
export const writeFile = (id: string, path: string, content: string) => attempt(() => getRunner().writeFile(id, path, content));
export const restoreCheckpoint = (id: string, messageId: string) => attempt(() => getRunner().restoreCheckpoint(id, messageId));

/** The diff with whitespace-only changes left out. */
export const readQuietDiff = (id: string) => attempt(async () => (await getRunner().getDiff(id, { ignoreWhitespace: true })).files);

export const listFiles = (id: string) => attempt(() => getRunner().listFiles(id));

/** Asks once per agent: it can start a process. */
export async function loadModels(agent: AgentKind) {
  if (useSolus.getState().models[agent]) return;
  const models = await attempt(() => getRunner().listModels(agent));
  if (models) useSolus.setState((s) => ({ models: { ...s.models, [agent]: models } }));
}

export const setChatOptions = (id: string, options: ChatOptions, chat: string) => attempt(() => getRunner().setChatOptions(id, options, chat));
export const editQueued = (id: string, queuedId: string, text: string, chat: string) => attempt(() => getRunner().editQueued(id, queuedId, text, chat));

export async function loadSettings() {
  const settings = await attempt(() => getRunner().getSettings());
  if (settings) useSolus.setState({ settings });
}

export async function saveSettings(changes: Partial<Settings>) {
  useSolus.setState((s) => ({ settings: { ...s.settings, ...changes } }));
  await attempt(() => getRunner().saveSettings(changes));
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
export const stopTask = (id: string, chat?: string) => attempt(() => getRunner().stopTask(id, chat));

/** Adds a chat to the task and opens its tab. */
export async function newChat(taskId: string, agent: AgentKind) {
  const chat = await attempt(() => getRunner().createChat(taskId, agent));
  if (chat) {
    useSolus.setState((s) => {
      const task = s.tasks[taskId];
      if (!task || task.chats?.some((c) => c.id === chat.id)) return s;
      return { tasks: { ...s.tasks, [taskId]: { ...task, chats: [...(task.chats ?? []), chat] } } };
    });
    useSolus.getState().openChat(taskId, chat.id);
  }
}
/** Goes to the chat showing in that task, unless one is named. */
export function sendMessage(id: string, text: string, agent?: AgentKind, chat?: string) {
  const s = useSolus.getState();
  const task = s.tasks[id];
  const target = chat ?? (task ? activeChatId(s, task) : MAIN_CHAT);
  if (task && agent && agent !== task.agent && target === MAIN_CHAT) {
    // Optimistic: show the new agent right away.
    useSolus.setState((state) => ({ tasks: { ...state.tasks, [id]: { ...task, agent } } }));
  }
  return attempt(() => getRunner().sendMessage(id, text, { ...(agent ? { agent } : {}), chat: target }));
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
