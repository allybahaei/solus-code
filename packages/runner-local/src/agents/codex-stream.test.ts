import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import { CodexStream, unwrapCommand, type CodexNotification } from "./codex-stream";

const RECORDED = join(__dirname, "../../../../docs/spike-6/fixtures/codex-app-server.jsonl");

function replay() {
  const stream = new CodexStream("/repo");
  return readFileSync(RECORDED, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => stream.push(JSON.parse(l) as CodexNotification));
}

const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

describe("a recorded Codex run", () => {
  it("streams each reply in pieces and closes it once", () => {
    const text = of(replay(), "text");
    const ids = [...new Set(text.map((t) => t.id))];
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) {
      const parts = text.filter((t) => t.id === id);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.filter((t) => t.done)).toHaveLength(1);
      expect(parts.at(-1)?.done).toBe(true);
    }
    expect(text.filter((t) => t.id === ids[0]).map((t) => t.chunk).join("")).toMatch(/^A Git worktree/);
  });

  it("shows the real command, not the shell wrapper", () => {
    const events = replay();
    expect(of(events, "tool")[0]).toMatchObject({ tool: "Bash", text: "curl -sI https://example.com | head -1" });
    expect(of(events, "terminal")[0]?.data).toMatch(/^\$ curl/);
  });

  it("ends each turn", () => {
    expect(of(replay(), "turn_end")).toHaveLength(3);
  });
});

const item = (fields: Record<string, unknown>): CodexNotification => ({
  method: "item/completed",
  params: { item: { id: "i", type: "x", ...fields } },
});

it("marks a failed command in the terminal", () => {
  const [terminal] = new CodexStream("/repo").push(item({ type: "commandExecution", command: "ls", exitCode: 6 }));
  expect(terminal).toMatchObject({ data: expect.stringContaining("(exit 6)") });
});

it("reports edits that happened, not ones that were declined", () => {
  const change = { type: "fileChange", changes: [{ path: "/repo/math.js", kind: "update" }] };
  const stream = new CodexStream("/repo");
  expect(stream.push(item({ ...change, status: "completed" }))).toEqual([{ type: "tool", tool: "Edit", text: "math.js" }, { type: "files_changed" }]);
  expect(stream.push(item({ ...change, status: "declined" }))).toEqual([]);
});

it("hides Solus's own tool from the tool rows", () => {
  const started = (server: string): CodexNotification => ({ method: "item/started", params: { item: { id: "i", type: "mcpToolCall", server, tool: "t" } } });
  const stream = new CodexStream("/repo");
  expect(stream.push(started("solus"))).toEqual([]);
  expect(stream.push(started("docs"))).toHaveLength(1);
});

it("reports a failed turn once, with its message, and nothing for an interrupted one", () => {
  const stream = new CodexStream("/repo");
  expect(stream.push({ method: "error" })).toEqual([]);
  expect(stream.push({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "Log in again." } } } })).toEqual([
    { type: "error", error: { message: "Log in again." } },
  ]);
  expect(stream.push({ method: "turn/completed", params: { turn: { status: "interrupted" } } })).toEqual([]);
});

it("unwraps quoted commands and leaves others alone", () => {
  expect(unwrapCommand(`/bin/zsh -lc 'curl -sI https://example.com'`)).toBe("curl -sI https://example.com");
  expect(unwrapCommand(`/bin/bash -lc "ls"`)).toBe("ls");
  expect(unwrapCommand("ls -la")).toBe("ls -la");
});
