import { compareTasks, type Task } from "@solus/core";

export interface SidebarSections {
  pinned: Task[];
  /** Everything not pinned and not merged: attention states first. */
  workspaces: Task[];
  merged: Task[];
}

export function sidebarSections(tasks: Iterable<Task>, pinned: readonly string[], query = ""): SidebarSections {
  const q = query.trim().toLowerCase();
  const all = [...tasks]
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.branch.toLowerCase().includes(q))
    .sort(compareTasks);
  const isPinned = (t: Task) => pinned.includes(t.id);
  return {
    pinned: all.filter(isPinned),
    workspaces: all.filter((t) => !isPinned(t) && t.state !== "merged"),
    merged: all.filter((t) => !isPinned(t) && t.state === "merged"),
  };
}

/** Tasks in sidebar order, as J/K walks them. */
export function navOrder(tasks: Iterable<Task>, pinned: readonly string[], showMerged: boolean, query = ""): Task[] {
  const s = sidebarSections(tasks, pinned, query);
  return [...s.pinned, ...s.workspaces, ...(showMerged ? s.merged : [])];
}
