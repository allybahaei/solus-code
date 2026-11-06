import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import { CodexStream, unwrapCommand, type CodexLine } from "./codex-stream";

const FIXTURES = join(__dirname, "../../../../docs/spike-2a/fixtures");

function replay(name: string) {
  const stream = new CodexStream("/repo", 1);
  const events = readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => stream.push(JSON.parse(l) as CodexLine));
  return { events, finished: stream.finished };
}

const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

describe("recorded Codex runs", () => {
  it("reads an edit", () => {
    const { events, finished } = replay("codex-1.jsonl");
    expect(finished).toBe(true);
    expect(of(events, "session")[0]?.id).toMatch(/^01a1b0/);
    expect(of(events, "tool").map((t) => t.tool)).toEqual(["Bash", "Bash", "Edit"]);
    expect(of(events, "tool").at(-1)?.text).toBe("math.js");
    expect(of(events, "text").every((t) => t.done)).toBe(true);
    expect(of(events, "text").length).toBeGreaterThan(0);
    expect(of(events, "files_changed").length).toBeGreaterThan(0);
  });

  it("shows the real command, not the shell wrapper", () => {
    const { events } = replay("codex-1.jsonl");
    expect(of(events, "tool")[0]?.text).toMatch(/^pwd && rg/);
    expect(of(events, "terminal")[0]?.data).toMatch(/^\$ pwd && rg/);
  });

  it("marks a failed command in the terminal", () => {
    const { events } = replay("codex-4.jsonl");
    expect(of(events, "terminal")[0]?.data).toContain("(exit 6)");
  });

  it("hides Solus's own tool from the tool rows", () => {
    const { events } = replay("codex-5.jsonl");
    expect(of(events, "tool").map((t) => t.tool)).not.toContain("solus.ask_user");
  });
});

it("reports a failed turn once, with its message", () => {
  const stream = new CodexStream("/repo", 1);
  expect(stream.push({ type: "error" })).toEqual([]);
  expect(stream.push({ type: "turn.failed", error: { message: "Log in again." } })).toEqual([
    { type: "error", error: { message: "Log in again." } },
  ]);
  expect(stream.finished).toBe(true);
});

it("keeps message ids unique across turns", () => {
  const line: CodexLine = { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Hi" } };
  const [a] = new CodexStream("/repo", 1).push(line);
  const [b] = new CodexStream("/repo", 2).push(line);
  expect(a).not.toEqual(b);
});

it("unwraps quoted commands and leaves others alone", () => {
  expect(unwrapCommand(`/bin/zsh -lc 'curl -sI https://example.com'`)).toBe("curl -sI https://example.com");
  expect(unwrapCommand(`/bin/bash -lc "ls"`)).toBe("ls");
  expect(unwrapCommand("ls -la")).toBe("ls -la");
});
