import { describe, expect, it } from "vitest";
import {
  TASK_STATES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isAttention,
} from "./state";
import { compareTasks, type Task } from "./task";

describe("task state machine", () => {
  it("allows exactly the transitions in the spec", () => {
    const allowed = TASK_STATES.flatMap((from) =>
      TASK_STATES.filter((to) => canTransition(from, to)).map((to) => `${from}→${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        "idle→working",
        "working→needs_input",
        "working→stuck",
        "working→ready_for_review",
        "needs_input→working",
        "stuck→working",
        "ready_for_review→working",
        "ready_for_review→merged",
      ].sort(),
    );
  });

  it("has an entry for every state", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...TASK_STATES].sort());
  });

  it("throws on an invalid transition", () => {
    expect(() => assertTransition("idle", "merged")).toThrow("idle → merged");
    expect(() => assertTransition("merged", "working")).toThrow();
  });

  it("marks only needs_input and stuck as attention states", () => {
    expect(TASK_STATES.filter(isAttention)).toEqual(["needs_input", "stuck"]);
  });
});

describe("compareTasks", () => {
  const task = (id: string, state: Task["state"], lastActivityAt: number): Task => ({
    id,
    title: id,
    prompt: "",
    repo: "acme/app",
    branch: id,
    baseBranch: "main",
    agent: "claude-code",
    state,
    changes: { files: 0, additions: 0, deletions: 0 },
    createdAt: 0,
    lastActivityAt,
  });

  it("puts attention states first, then newest activity", () => {
    const sorted = [
      task("a", "working", 50),
      task("b", "stuck", 10),
      task("c", "needs_input", 5),
      task("d", "merged", 100),
      task("e", "working", 90),
      task("f", "ready_for_review", 1),
    ].sort(compareTasks);
    expect(sorted.map((t) => t.id)).toEqual(["c", "b", "f", "e", "a", "d"]);
  });
});
