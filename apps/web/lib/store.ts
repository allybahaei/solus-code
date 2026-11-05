"use client";

import { create } from "zustand";
import type { AgentMessage, DiffFile, Runner, Task } from "@solus/core";
import { navOrder } from "./groups";

/** What the center pane shows when the right pane doesn't fit. */
export type CenterView = "chat" | "changes" | "terminal";

interface SolusState {
  status: "connecting" | "ready" | "error";
  error: string | null;
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

  open: (id: string) => void;
  closeTab: (id: string) => void;
  cycleTab: (delta: 1 | -1) => void;
  move: (delta: 1 | -1) => void;
  setCenterView: (view: CenterView) => void;
  setShowList: (show: boolean) => void;
  toggleMerged: () => void;
  setNewTaskOpen: (open: boolean) => void;
  setNotice: (notice: string | null) => void;
}

export const useSolus = create<SolusState>()((set, get) => ({
  status: "connecting",
  error: null,
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

  open: (id) =>
    set((s) => ({
      activeId: id,
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
      return { openTabs, activeId, showList: activeId === null ? true : s.showList };
    }),

  cycleTab: (delta) => {
    const { openTabs, activeId } = get();
    if (openTabs.length === 0) return;
    const i = activeId ? openTabs.indexOf(activeId) : -1;
    const next = openTabs[(i + delta + openTabs.length) % openTabs.length];
    if (next) set({ activeId: next, centerView: "chat" });
  },

  move: (delta) => {
    const { tasks, activeId, showMerged, open } = get();
    const order = navOrder(Object.values(tasks), showMerged);
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
}));

/** Loads a snapshot from the runner and keeps the store in sync. Returns unsubscribe. */
export function connectRunner(runner: Runner): () => void {
  const { setState: set, getState: get } = useSolus;

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

  (async () => {
    try {
      const tasks = await runner.listTasks();
      const entries = await Promise.all(
        tasks.map(async (t) => {
          const [messages, diff] = await Promise.all([runner.getMessages(t.id), runner.getDiff(t.id)]);
          return { t, messages, files: diff.files };
        }),
      );
      // Events may have arrived while loading; keep anything newer.
      set((s) => ({
        status: "ready",
        tasks: Object.fromEntries(entries.map(({ t }) => [t.id, s.tasks[t.id] ?? t])),
        messages: Object.fromEntries(entries.map(({ t, messages }) => [t.id, s.messages[t.id] ?? messages])),
        diffs: Object.fromEntries(entries.map(({ t, files }) => [t.id, s.diffs[t.id] ?? files])),
      }));
      if (get().activeId === null) {
        const first = navOrder(Object.values(get().tasks), false)[0];
        if (first) set({ activeId: first.id, openTabs: [first.id] });
      }
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return unsubscribe;
}
