"use client";

import { create } from "zustand";
import { DEFAULT_SETTINGS, MAIN_CHAT, chatsOf, type AgentMessage, type AgentKind, type Chat, type DiffFile, type ModelOption, type OpenTarget, type RepoInfo, type Runner, type RunnerSnapshot, type Settings, type SetupStatus, type Task } from "@solus/core";
import { DEFAULT_VIEW, navOrder, type SidebarView } from "./groups";

/** What the center pane shows when the right pane doesn't fit. */
export type CenterView = "chat" | "changes" | "terminal" | "run";
export type Overlay = "palette" | "shortcuts" | "settings";

interface SolusState {
  status: "connecting" | "ready" | "error";
  error: string | null;
  /** False while the connection to the daemon is down. */
  connected: boolean;
  repo: RepoInfo | null;
  setup: SetupStatus | null;
  tasks: Record<string, Task>;
  messages: Record<string, AgentMessage[]>;
  diffs: Record<string, DiffFile[]>;
  /** Raw terminal chunks per task, written to xterm in order. */
  terminal: Record<string, string[]>;
  /** Output from saved commands, per task. */
  runOutput: Record<string, string[]>;
  /** Short-lived message for a failed action. */
  notice: string | null;

  openTabs: string[];
  activeId: string | null;
  centerView: CenterView;
  /** Phone only: the workspace list is the whole screen. */
  showList: boolean;
  showMerged: boolean;
  newTaskOpen: boolean;
  /** Pinned task ids, kept per browser. */
  pinned: string[];
  /** When the user last looked at each task; newer activity shows as unread. */
  lastSeen: Record<string, number>;
  /** Sidebar filter. null when the search box is closed. */
  query: string | null;
  /** Local display names, set by renaming a tab. Kept per browser. */
  renames: Record<string, string>;
  /** The chat tab showing in each task. */
  activeChat: Record<string, string>;
  /** Chat tabs closed in each task, newest first. Reopened from the history menu. */
  closedChats: Record<string, string[]>;
  /** Whether the changes/terminal pane is shown on wide screens. */
  rightPaneOpen: boolean;
  sidebarOpen: boolean;
  /** The one overlay showing, if any. */
  overlay: Overlay | null;
  /** Apps that can open a worktree, once asked for. */
  openTargets: OpenTarget[] | null;
  settings: Settings;
  /** Models per agent, once asked for. */
  models: Partial<Record<AgentKind, ModelOption[]>>;
  sidebarView: SidebarView;
  /** Open pull requests' overall state, by task. */
  prHealth: Record<string, PullRequestHealth>;
  /** The terminal has the whole window, beside the sidebar. */
  terminalBig: boolean;

  open: (id: string) => void;
  openChat: (taskId: string, chatId: string) => void;
  closeChat: (taskId: string, chatId: string) => void;
  cycleTab: (delta: 1 | -1) => void;
  move: (delta: 1 | -1) => void;
  setCenterView: (view: CenterView) => void;
  setShowList: (show: boolean) => void;
  toggleMerged: () => void;
  setNewTaskOpen: (open: boolean) => void;
  setNotice: (notice: string | null) => void;
  togglePin: (id: string) => void;
  setQuery: (query: string | null) => void;
  rename: (id: string, title: string) => void;
  toggleRightPane: () => void;
  toggleSidebar: () => void;
  setOverlay: (overlay: Overlay | null) => void;
  setSidebarView: (view: Partial<SidebarView>) => void;
  toggleTerminalBig: () => void;
}

const RENAMES_KEY = "solus.renames";
const VIEW_KEY = "solus.sidebarView";

export type PullRequestHealth = "passed" | "failed" | "pending" | "conflict";

function loadView(): SidebarView {
  try {
    return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<SidebarView>) };
  } catch {
    return DEFAULT_VIEW;
  }
}

function loadRenames(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RENAMES_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The name shown for a task: the user's rename, or the task title. */
export function displayTitle(s: Pick<SolusState, "renames">, task: Task): string {
  return s.renames[task.id] ?? task.title;
}

/** The name shown for a chat tab. */
export function chatTitle(s: Pick<SolusState, "renames">, task: Task, chat: Chat): string {
  return s.renames[`${task.id}/${chat.id}`] ?? chat.title;
}

/** Chats with an open tab. One asking for a person always has a tab. */
export function visibleChats(s: Pick<SolusState, "closedChats">, task: Task): Chat[] {
  const closed = s.closedChats[task.id] ?? [];
  return chatsOf(task).filter((c) => !closed.includes(c.id) || c.state === "needs_input" || c.state === "stuck");
}

/** Which chat tab a task is showing. */
export function activeChatId(s: Pick<SolusState, "activeChat" | "closedChats">, task: Task): string {
  const chats = visibleChats(s, task);
  const wanted = s.activeChat[task.id];
  return chats.find((c) => c.id === wanted)?.id ?? chats[0]?.id ?? MAIN_CHAT;
}

/** A task as one chat sees it, so the chat and composer read that chat's state. */
export function taskInChat(task: Task, chatId: string): Task {
  const chat = chatsOf(task).find((c) => c.id === chatId);
  if (!chat) return task;
  const view: Task = { ...task, agent: chat.agent, state: task.state === "merged" ? "merged" : chat.state };
  delete view.question;
  delete view.approval;
  delete view.error;
  return {
    ...view,
    ...(chat.question ? { question: chat.question } : {}),
    ...(chat.approval ? { approval: chat.approval } : {}),
    ...(chat.error ? { error: chat.error } : {}),
  };
}

const PINNED_KEY = "solus.pinned";

function savePinned(pinned: string[]) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
  } catch {}
}

function loadPinned(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Marks the task being left and the task being opened as seen. */
function seen(s: SolusState, ...ids: (string | null)[]): Record<string, number> {
  const now = Date.now();
  const lastSeen = { ...s.lastSeen };
  for (const id of ids) if (id) lastSeen[id] = now;
  return lastSeen;
}

export const useSolus = create<SolusState>()((set, get) => ({
  status: "connecting",
  error: null,
  connected: true,
  repo: null,
  setup: null,
  tasks: {},
  messages: {},
  diffs: {},
  terminal: {},
  runOutput: {},
  notice: null,

  openTabs: [],
  activeId: null,
  centerView: "chat",
  showList: true,
  showMerged: false,
  newTaskOpen: false,
  pinned: [],
  lastSeen: {},
  query: null,
  renames: {},
  activeChat: {},
  closedChats: {},
  rightPaneOpen: true,
  sidebarOpen: true,
  overlay: null,
  openTargets: null,
  settings: DEFAULT_SETTINGS,
  models: {},
  sidebarView: DEFAULT_VIEW,
  prHealth: {},
  terminalBig: false,

  open: (id) =>
    set((s) => ({
      activeId: id,
      lastSeen: seen(s, s.activeId, id),
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      showList: false,
      centerView: "chat",
    })),

  openChat: (taskId, chatId) =>
    set((s) => ({
      activeChat: { ...s.activeChat, [taskId]: chatId },
      closedChats: { ...s.closedChats, [taskId]: (s.closedChats[taskId] ?? []).filter((c) => c !== chatId) },
      centerView: "chat",
    })),

  closeChat: (taskId, chatId) =>
    set((s) => {
      const task = s.tasks[taskId];
      // The last tab stays, so a task always has a chat to show.
      if (!task || visibleChats(s, task).length < 2) return s;
      return { closedChats: { ...s.closedChats, [taskId]: [chatId, ...(s.closedChats[taskId] ?? [])] } };
    }),

  cycleTab: (delta) => {
    const s = get();
    const task = s.activeId ? s.tasks[s.activeId] : undefined;
    if (!task) return;
    const chats = visibleChats(s, task);
    const i = chats.findIndex((c) => c.id === activeChatId(s, task));
    const next = chats[(i + delta + chats.length) % chats.length];
    if (next) s.openChat(task.id, next.id);
  },

  move: (delta) => {
    const { tasks, activeId, showMerged, open, pinned, query, sidebarView } = get();
    const order = navOrder(Object.values(tasks), pinned, showMerged, query ?? "", sidebarView);
    if (order.length === 0) return;
    const i = order.findIndex((t) => t.id === activeId);
    const next = i === -1 ? order[0] : order[Math.min(order.length - 1, Math.max(0, i + delta))];
    if (next) open(next.id);
  },

  setCenterView: (centerView) => set({ centerView }),
  setShowList: (showList) => set({ showList }),
  toggleMerged: () => set((s) => ({ showMerged: !s.showMerged })),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),
  setNotice: (notice) => set({ notice }),
  togglePin: (id) =>
    set((s) => {
      const pinned = s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id];
      savePinned(pinned);
      return { pinned };
    }),
  setQuery: (query) => set({ query }),
  rename: (id, title) =>
    set((s) => {
      const renames = { ...s.renames };
      const trimmed = title.trim();
      if (!trimmed || trimmed === s.tasks[id]?.title) delete renames[id];
      else renames[id] = trimmed;
      try {
        localStorage.setItem(RENAMES_KEY, JSON.stringify(renames));
      } catch {}
      return { renames };
    }),
  toggleRightPane: () => set((s) => ({ rightPaneOpen: !s.rightPaneOpen })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setOverlay: (overlay) => set({ overlay }),
  setSidebarView: (changes) =>
    set((s) => {
      const sidebarView = { ...s.sidebarView, ...changes };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(sidebarView));
      } catch {}
      return { sidebarView };
    }),
  toggleTerminalBig: () => set((s) => ({ terminalBig: !s.terminalBig })),
}));

/** A runner reached over a connection that can drop, such as RemoteRunner. */
export interface ConnectionSource {
  onStatus: (listener: (status: "connecting" | "open" | "closed") => void) => () => void;
}

/** Replaces the store's data with a fresh snapshot, keeping what's on screen where it can. */
function applySnapshot(snapshot: RunnerSnapshot) {
  const { setState: set, getState: get } = useSolus;
  const ids = new Set(snapshot.tasks.map((t) => t.id));
  set((s) => {
    const openTabs = s.openTabs.filter((id) => ids.has(id));
    const activeId = s.activeId && ids.has(s.activeId) ? s.activeId : (openTabs[0] ?? null);
    return {
      status: "ready",
      error: null,
      repo: snapshot.repo,
      pinned: loadPinned(),
      renames: loadRenames(),
      sidebarView: loadView(),
      // Everything that happened before you opened the app counts as seen.
      lastSeen: Object.fromEntries(snapshot.tasks.map((t) => [t.id, s.lastSeen[t.id] ?? Date.now()])),
      tasks: Object.fromEntries(snapshot.tasks.map((t) => [t.id, t])),
      messages: snapshot.messages,
      diffs: snapshot.diffs,
      terminal: snapshot.terminal,
      runOutput: snapshot.runOutput,
      openTabs,
      activeId,
    };
  });
  if (get().activeId === null) {
    const first = navOrder(Object.values(get().tasks), get().pinned, false)[0];
    if (first) set({ activeId: first.id, openTabs: [first.id] });
  }
}

/**
 * Keeps the store in sync with a runner. With a connection, reloads a snapshot
 * on every connect, since events sent while disconnected are gone. Returns a
 * function that stops listening.
 */
export function connectRunner(runner: Runner, connection?: ConnectionSource): () => void {
  const { setState: set } = useSolus;

  const load = () =>
    runner
      .snapshot()
      .then(applySnapshot)
      .then(() => Promise.all([runner.checkSetup(), runner.getSettings()]))
      .then(([setup, settings]) => set({ setup, settings }))
      .catch((err: unknown) => {
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });

  const refreshDiff = (id: string) => {
    runner
      .getDiff(id)
      .then((d) => set((s) => ({ diffs: { ...s.diffs, [id]: d.files } })))
      .catch(() => {});
  };

  const unsubscribe = runner.subscribe((e) => {
    switch (e.type) {
      case "run.output":
        set((s) => ({
          runOutput: { ...s.runOutput, [e.taskId]: [...(s.runOutput[e.taskId] ?? []), e.data] },
        }));
        break;

      case "task.created":
      case "task.updated":
      case "task.state_changed":
        set((s) => ({ tasks: { ...s.tasks, [e.taskId]: e.task } }));
        break;

      case "task.deleted":
        set((s) => {
          const tasks = { ...s.tasks };
          delete tasks[e.taskId];
          const i = s.openTabs.indexOf(e.taskId);
          const openTabs = s.openTabs.filter((id) => id !== e.taskId);
          const activeId = s.activeId === e.taskId ? (openTabs[Math.min(i, openTabs.length - 1)] ?? null) : s.activeId;
          return { tasks, openTabs, activeId };
        });
        break;

      case "agent.output":
        set((s) => {
          const list = s.messages[e.taskId] ?? [];
          // Not always the last: chats running together stream side by side.
          const i = list.findLastIndex((m) => m.id === e.messageId);
          const found = list[i];
          const messages = found
            ? list.with(i, { ...found, text: found.text + e.chunk })
            : [
                ...list,
                {
                  id: e.messageId,
                  taskId: e.taskId,
                  role: e.role,
                  text: e.chunk,
                  at: e.at,
                  ...(e.tool ? { tool: e.tool } : {}),
                  ...(e.chatId ? { chatId: e.chatId } : {}),
                },
              ];
          const task = s.tasks[e.taskId];
          return {
            messages: { ...s.messages, [e.taskId]: messages },
            tasks: task ? { ...s.tasks, [e.taskId]: { ...task, lastActivityAt: e.at } } : s.tasks,
          };
        });
        break;

      case "terminal.output":
        set((s) => ({
          terminal: { ...s.terminal, [e.taskId]: [...(s.terminal[e.taskId] ?? []), e.data] },
        }));
        break;

      case "diff.updated":
        set((s) => {
          const task = s.tasks[e.taskId];
          if (!task) return s;
          return { tasks: { ...s.tasks, [e.taskId]: { ...task, changes: e.changes, lastActivityAt: e.at } } };
        });
        refreshDiff(e.taskId);
        break;

      case "error":
        set({ notice: e.message });
        break;
    }
  });

  if (!connection) {
    void load();
    return unsubscribe;
  }

  const stopWatching = connection.onStatus((status) => {
    set({ connected: status !== "closed" });
    if (status === "open") void load();
  });
  return () => {
    stopWatching();
    unsubscribe();
  };
}
