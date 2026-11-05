"use client";

import { create } from "zustand";

export type DiffSide = "old" | "new";

export interface ReviewComment {
  id: string;
  path: string;
  side: DiffSide;
  line: number;
  text: string;
}

export interface TaskReview {
  comments: ReviewComment[];
  /** Paths ticked as viewed. */
  viewed: string[];
  /** Overall comment, sent with "Request changes". */
  summary: string;
}

export type MergeMode = "pr" | "merge";
export type DiffMode = "unified" | "split";

interface ReviewState {
  /** Whether each task shows its chat or its review in the middle pane. */
  view: Record<string, "chat" | "review">;
  reviews: Record<string, TaskReview>;
  diffMode: DiffMode;
  /** A file the review should scroll to, set from the changes list. */
  scrollTarget: { taskId: string; path: string; nonce: number } | null;
  /** The file currently in view, highlighted in the changes list. */
  inView: string | null;
  merge: { taskId: string; mode: MergeMode } | null;
  lastMergeMode: MergeMode;

  setView: (taskId: string, view: "chat" | "review") => void;
  showFile: (taskId: string, path: string) => void;
  setInView: (path: string | null) => void;
  addComment: (taskId: string, comment: Omit<ReviewComment, "id">) => void;
  updateComment: (taskId: string, id: string, text: string) => void;
  deleteComment: (taskId: string, id: string) => void;
  toggleViewed: (taskId: string, path: string) => void;
  setSummary: (taskId: string, summary: string) => void;
  clearReview: (taskId: string) => void;
  setDiffMode: (mode: DiffMode) => void;
  openMerge: (taskId: string, mode?: MergeMode) => void;
  closeMerge: () => void;
}

const EMPTY: TaskReview = { comments: [], viewed: [], summary: "" };
const DIFF_MODE_KEY = "solus.diffMode";
const MERGE_MODE_KEY = "solus.mergeMode";

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function reviewOf(s: Pick<ReviewState, "reviews">, taskId: string): TaskReview {
  return s.reviews[taskId] ?? EMPTY;
}

let nextId = 1;

export const useReview = create<ReviewState>()((set) => {
  const patch = (taskId: string, fn: (r: TaskReview) => Partial<TaskReview>) =>
    set((s) => {
      const r = reviewOf(s, taskId);
      return { reviews: { ...s.reviews, [taskId]: { ...r, ...fn(r) } } };
    });

  return {
    view: {},
    reviews: {},
    diffMode: "unified",
    scrollTarget: null,
    inView: null,
    merge: null,
    lastMergeMode: "pr",

    setView: (taskId, view) => set((s) => ({ view: { ...s.view, [taskId]: view } })),
    showFile: (taskId, path) =>
      set((s) => ({
        view: { ...s.view, [taskId]: "review" },
        scrollTarget: { taskId, path, nonce: (s.scrollTarget?.nonce ?? 0) + 1 },
      })),
    setInView: (inView) => set({ inView }),
    addComment: (taskId, comment) =>
      patch(taskId, (r) => ({ comments: [...r.comments, { ...comment, id: `c${nextId++}` }] })),
    updateComment: (taskId, id, text) =>
      patch(taskId, (r) => ({ comments: r.comments.map((c) => (c.id === id ? { ...c, text } : c)) })),
    deleteComment: (taskId, id) => patch(taskId, (r) => ({ comments: r.comments.filter((c) => c.id !== id) })),
    toggleViewed: (taskId, path) =>
      patch(taskId, (r) => ({
        viewed: r.viewed.includes(path) ? r.viewed.filter((p) => p !== path) : [...r.viewed, path],
      })),
    setSummary: (taskId, summary) => patch(taskId, () => ({ summary })),
    clearReview: (taskId) => patch(taskId, () => ({ comments: [], summary: "" })),
    setDiffMode: (diffMode) => {
      write(DIFF_MODE_KEY, diffMode);
      set({ diffMode });
    },
    openMerge: (taskId, mode) => set((s) => ({ merge: { taskId, mode: mode ?? s.lastMergeMode } })),
    closeMerge: () => set({ merge: null }),
  };
});

/** Loads per-browser preferences. Call once on the client. */
export function loadReviewPrefs() {
  useReview.setState({
    diffMode: read(DIFF_MODE_KEY, ["unified", "split"] as const, "unified"),
    lastMergeMode: read(MERGE_MODE_KEY, ["pr", "merge"] as const, "pr"),
  });
}

export function rememberMergeMode(mode: MergeMode) {
  write(MERGE_MODE_KEY, mode);
  useReview.setState({ lastMergeMode: mode });
}
