import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_STATES, canTransition, type RunnerEvent, type TaskState } from "@solus/core";
import { MockRunner } from "./mock-runner";
import { SCENARIOS } from "./scenarios";

const MIN = 60_000;

let runner: MockRunner;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  runner.dispose();
  vi.useRealTimers();
});

function record(r: MockRunner): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  r.subscribe((e) => events.push(e));
  return events;
}

async function stateOf(r: MockRunner, id: string): Promise<TaskState | undefined> {
  return (await r.listTasks()).find((t) => t.id === id)?.state;
}

describe("MockRunner with autopilot", () => {
  it("moves the scripted tasks through every state, using only allowed transitions", async () => {
    runner = new MockRunner({ autopilot: true });
    const seen = new Set<TaskState>((await runner.listTasks()).map((t) => t.state));
    const events = record(runner);

    await vi.advanceTimersByTimeAsync(5 * MIN);

    const changes = events.filter((e) => e.type === "task.state_changed");
    for (const c of changes) {
      expect(canTransition(c.from, c.to), `${c.from} → ${c.to}`).toBe(true);
      seen.add(c.to);
    }
    expect([...seen].sort()).toEqual([...TASK_STATES].sort());
    expect(events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("ends in a mix of states rather than all merged", async () => {
    runner = new MockRunner({ autopilot: true });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    const states = Object.fromEntries((await runner.listTasks()).map((t) => [t.id, t.state]));
    expect(states).toEqual({
      tsk_rate_limit: "ready_for_review",
      tsk_flaky_totals: "merged",
      tsk_date_fns: "ready_for_review",
      tsk_dark_mode: "merged",
      tsk_stripe_v22: "merged",
      tsk_csv_export: "needs_input",
    });
  });
});

describe("MockRunner without autopilot", () => {
  beforeEach(() => {
    runner = new MockRunner();
  });

  it("seeds six tasks with realistic content", async () => {
    const tasks = await runner.listTasks();
    expect(tasks).toHaveLength(SCENARIOS.length);
    expect(tasks).toHaveLength(6);
    for (const t of tasks) {
      expect(t.lastActivityAt).toBeGreaterThanOrEqual(t.createdAt);
      expect(t.branch).toMatch(/^solus\//);
    }
  });

  it("waits at needs_input until the user replies, then finishes", async () => {
    await vi.advanceTimersByTimeAsync(2 * MIN);
    const task = (await runner.listTasks()).find((t) => t.id === "tsk_rate_limit");
    expect(task?.state).toBe("needs_input");
    expect(task?.question).toMatch(/Redis/);

    await runner.sendMessage("tsk_rate_limit", "Use Redis.");
    expect(await stateOf(runner, "tsk_rate_limit")).toBe("working");

    await vi.advanceTimersByTimeAsync(2 * MIN);
    const after = (await runner.listTasks()).find((t) => t.id === "tsk_rate_limit");
    expect(after?.state).toBe("ready_for_review");
    expect(after?.question).toBeUndefined();

    const diff = await runner.getDiff("tsk_rate_limit");
    expect(diff.files.map((f) => f.path).sort()).toEqual([
      "app/api/checkout/route.ts",
      "package.json",
      "src/lib/rate-limit.test.ts",
      "src/lib/rate-limit.ts",
    ]);
    expect(after?.changes.files).toBe(4);
  });

  it("streams agent messages in chunks that add up to the full text", async () => {
    const events = record(runner);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    const chunks = events.filter((e) => e.type === "agent.output" && e.taskId === "tsk_rate_limit");
    const byMessage = new Map<string, string>();
    for (const c of chunks) {
      if (c.type !== "agent.output") continue;
      byMessage.set(c.messageId, (byMessage.get(c.messageId) ?? "") + c.chunk);
    }
    const messages = await runner.getMessages("tsk_rate_limit");
    for (const [id, text] of byMessage) {
      expect(messages.find((m) => m.id === id)?.text).toBe(text);
    }
    expect(chunks.some((c) => c.type === "agent.output" && !c.done)).toBe(true);
  });

  it("stopping a working task makes it stuck, and a nudge resumes it", async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await runner.stopTask("tsk_date_fns");
    const stuck = (await runner.listTasks()).find((t) => t.id === "tsk_date_fns");
    expect(stuck?.state).toBe("stuck");
    expect(stuck?.error?.message).toBe("Stopped by you");

    await runner.sendMessage("tsk_date_fns", "Carry on.");
    expect(await stateOf(runner, "tsk_date_fns")).toBe("working");
    await vi.advanceTimersByTimeAsync(MIN);
    expect(await stateOf(runner, "tsk_date_fns")).toBe("ready_for_review");
  });

  it("opens a pull request and marks the task merged", async () => {
    const { url } = await runner.openPullRequest("tsk_stripe_v22", {
      title: "Upgrade Stripe SDK to v22",
      body: "",
      baseBranch: "main",
    });
    expect(url).toBe("https://github.com/acme/storefront/pull/412");
    const task = (await runner.listTasks()).find((t) => t.id === "tsk_stripe_v22");
    expect(task?.state).toBe("merged");
    expect(task?.pullRequest?.number).toBe(412);
  });

  it("refuses to merge a task that isn't ready for review", async () => {
    await expect(
      runner.merge("tsk_csv_export", { targetBranch: "main", commitMessage: "x", strategy: "merge" }),
    ).rejects.toThrow(/while it is idle/);
    await expect(runner.sendMessage("tsk_csv_export", "hi")).rejects.toThrow(/Start task/);
  });

  it("creates, starts and finishes a new task", async () => {
    const events = record(runner);
    const task = await runner.createTask({
      repo: "acme/storefront",
      title: "Add a sitemap",
      prompt: "Generate sitemap.xml from the product catalogue.",
      baseBranch: "main",
    });
    expect(task.state).toBe("idle");
    expect(task.branch).toBe("solus/add-a-sitemap");
    expect(events[0]?.type).toBe("task.created");

    await runner.startTask(task.id);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(await stateOf(runner, task.id)).toBe("ready_for_review");
    expect((await runner.getDiff(task.id)).files).toHaveLength(1);
  });

  it("requesting changes sends a reviewed task back to working", async () => {
    await runner.sendMessage("tsk_dark_mode", "Default to System, store it in a cookie.");
    expect(await stateOf(runner, "tsk_dark_mode")).toBe("working");
    await vi.advanceTimersByTimeAsync(MIN);
    expect(await stateOf(runner, "tsk_dark_mode")).toBe("ready_for_review");
    const paths = (await runner.getDiff("tsk_dark_mode")).files.map((f) => f.path);
    expect(paths).toContain("src/lib/theme.ts");
  });
});
