import { compareTasks, isAttention, type Task } from "@solus/core";

export interface SidebarSections {
  pinned: Task[];
  /** Everything not pinned and not merged: attention states first. */
  workspaces: Task[];
  merged: Task[];
  archived: Task[];
}

export type SidebarFilter = "all" | "attention" | "working" | "review";
export type SidebarSort = "attention" | "recent" | "created";
export interface SidebarView {
  filter: SidebarFilter;
  sort: SidebarSort;
}

export const DEFAULT_VIEW: SidebarView = { filter: "all", sort: "attention" };

const FILTERS: Record<SidebarFilter, (t: Task) => boolean> = {
  all: () => true,
  attention: (t) => isAttention(t.state),
  working: (t) => t.state === "working",
  review: (t) => t.state === "ready_for_review",
};

const SORTS: Record<SidebarSort, (a: Task, b: Task) => number> = {
  attention: compareTasks,
  recent: (a, b) => b.lastActivityAt - a.lastActivityAt,
  created: (a, b) => b.createdAt - a.createdAt,
};

export function sidebarSections(tasks: Iterable<Task>, pinned: readonly string[], query = "", view: SidebarView = DEFAULT_VIEW): SidebarSections {
  const q = query.trim().toLowerCase();
  const all = [...tasks]
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.branch.toLowerCase().includes(q))
    .filter(FILTERS[view.filter])
    .sort(SORTS[view.sort]);
  const live = all.filter((t) => !t.archivedAt);
  const isPinned = (t: Task) => pinned.includes(t.id);
  return {
    pinned: live.filter(isPinned),
    workspaces: live.filter((t) => !isPinned(t) && t.state !== "merged"),
    merged: live.filter((t) => !isPinned(t) && t.state === "merged"),
    archived: all.filter((t) => t.archivedAt),
  };
}

/** Tasks in sidebar order, as J/K walks them. */
export function navOrder(tasks: Iterable<Task>, pinned: readonly string[], showMerged: boolean, query = "", view: SidebarView = DEFAULT_VIEW): Task[] {
  const s = sidebarSections(tasks, pinned, query, view);
  return [...s.pinned, ...s.workspaces, ...(showMerged ? s.merged : [])];
}
