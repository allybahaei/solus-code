"use client";

import { create } from "zustand";
import type { AgentMessage, DiffFile, RepoInfo, Runner, RunnerSnapshot, Task } from "@solus/core";
import { navOrder } from "./groups";

/** What the center pane shows when the right pane doesn't fit. */
export type CenterView = "chat" | "changes" | "terminal";

interface SolusState {
  status: "connecting" | "ready" | "error";
  error: string | null;
  /** False while the connection to the daemon is down. */
  connected: boolean;
  repo: RepoInfo | null;
  tasks: Record<string, Task>;
  messages: Record<string, AgentMessage[]>;
  diffs: Record<string, DiffFile[]>;
  /** Raw terminal chunks per task, written to xterm in order. */
  terminal: Record<string, string[]>;
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
  /** Recently closed tabs, newest first, for the history menu. */
  closedTabs: string[];
  /** Whether the changes/terminal pane is shown on wide screens. */
  rightPaneOpen: boolean;

  open: (id: string) => void;
  closeTab: (id: string) => void;
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
}

const RENAMES_KEY = "solus.renames";

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
  tasks: {},
  messages: {},
  diffs: {},
  terminal: {},
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
  closedTabs: [],
  rightPaneOpen: true,

  open: (id) =>
    set((s) => ({
      activeId: id,
      lastSeen: seen(s, s.activeId, id),
      closedTabs: s.closedTabs.filter((t) => t !== id),
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      showList: false,
      centerView: "chat",
    })),

  closeTab: (id) =>
    set((s) => {
      const i = s.openTabs.indexOf(id);
      const openTabs = s.openTabs.filter((t) => t !== id);
      const activeId =
        s.activeId === id ? (openTabs[Math.min(i, openTabs.length - 1)] ?? null) : s.activeId;
      const closedTabs = [id, ...s.closedTabs.filter((t) => t !== id)].slice(0, 10);
      return { openTabs, activeId, closedTabs, showList: activeId === null ? true : s.showList };
    }),

  cycleTab: (delta) => {
    const { openTabs, activeId } = get();
    if (openTabs.length === 0) return;
    const i = activeId ? openTabs.indexOf(activeId) : -1;
    const next = openTabs[(i + delta + openTabs.length) % openTabs.length];
    if (next) set((s) => ({ activeId: next, centerView: "chat", lastSeen: seen(s, s.activeId, next) }));
  },

  move: (delta) => {
    const { tasks, activeId, showMerged, open, pinned, query } = get();
    const order = navOrder(Object.values(tasks), pinned, showMerged, query ?? "");
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
      // Everything that happened before you opened the app counts as seen.
      lastSeen: Object.fromEntries(snapshot.tasks.map((t) => [t.id, s.lastSeen[t.id] ?? Date.now()])),
      tasks: Object.fromEntries(snapshot.tasks.map((t) => [t.id, t])),
      messages: snapshot.messages,
      diffs: snapshot.diffs,
      terminal: snapshot.terminal,
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
      case "task.created":
      case "task.state_changed":
        set((s) => ({ tasks: { ...s.tasks, [e.taskId]: e.task } }));
        break;

      case "agent.output":
        set((s) => {
          const list = s.messages[e.taskId] ?? [];
          const last = list.at(-1);
          const messages =
            last?.id === e.messageId
              ? [...list.slice(0, -1), { ...last, text: last.text + e.chunk }]
              : [
                  ...list,
                  {
                    id: e.messageId,
                    taskId: e.taskId,
                    role: e.role,
                    text: e.chunk,
                    at: e.at,
                    ...(e.tool ? { tool: e.tool } : {}),
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
