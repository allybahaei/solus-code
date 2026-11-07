import { describe, expect, it } from "vitest";
import type { Task } from "@solus/core";
import { alertFor, attentionCount } from "./alerts";

const task = (fields: Partial<Task>) => ({ title: "Fix login", state: "working", ...fields }) as Task;

describe("alertFor", () => {
  it("speaks up when a task needs the person", () => {
    expect(alertFor(task({ state: "needs_input", question: "Which one?" }))).toEqual({ title: "Fix login", body: "Which one?" });
    expect(alertFor(task({ state: "stuck", error: { message: "Stalled" } }))?.body).toBe("Stalled");
    expect(alertFor(task({ state: "ready_for_review" }))?.body).toBe("Ready for review.");
  });

  it("stays quiet otherwise", () => {
    expect(alertFor(task({ state: "working" }))).toBeUndefined();
    expect(alertFor(task({ state: "merged" }))).toBeUndefined();
  });
});

it("counts tasks waiting on the person, but not archived or finished ones", () => {
  expect(attentionCount([task({ state: "needs_input" }), task({ state: "stuck" }), task({ state: "ready_for_review" }), task({ state: "stuck", archivedAt: 1 })])).toBe(2);
});
