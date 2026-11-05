import { compareTasks, type Task, type TaskState } from "@solus/core";

export interface TaskGroup {
  id: "attention" | "review" | "active" | "merged";
  label: string;
  states: readonly TaskState[];
}

/** Sidebar sections, in order. Attention first, merged last (collapsed). */
export const GROUPS: readonly TaskGroup[] = [
  { id: "attention", label: "Needs you", states: ["needs_input", "stuck"] },
  { id: "review", label: "Ready for review", states: ["ready_for_review"] },
  { id: "active", label: "In progress", states: ["working", "idle"] },
  { id: "merged", label: "Merged", states: ["merged"] },
];

export function groupTasks(tasks: Iterable<Task>): { group: TaskGroup; tasks: Task[] }[] {
  const all = [...tasks].sort(compareTasks);
  return GROUPS.map((group) => ({
    group,
    tasks: all.filter((t) => group.states.includes(t.state)),
  }));
}

/** Tasks in sidebar order, as J/K walks them. */
export function navOrder(tasks: Iterable<Task>, showMerged: boolean): Task[] {
  return groupTasks(tasks)
    .filter(({ group }) => showMerged || group.id !== "merged")
    .flatMap(({ tasks }) => tasks);
}
