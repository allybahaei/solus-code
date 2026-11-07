import { isAttention, type Task } from "@solus/core";

/** What to tell the person about a task's new state, if it's worth interrupting them. */
export function alertFor(task: Task): { title: string; body: string } | undefined {
  if (task.state === "needs_input") return { title: task.title, body: task.question ?? "Needs your answer." };
  if (task.state === "stuck") return { title: task.title, body: task.error?.message ?? "The agent is stuck." };
  if (task.state === "ready_for_review") return { title: task.title, body: "Ready for review." };
  return undefined;
}

/** The Dock badge: tasks waiting on the person, not ones that are simply done. */
export function attentionCount(tasks: readonly Task[]): number {
  return tasks.filter((t) => isAttention(t.state) && !t.archivedAt).length;
}
