import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import { ClaudeStream, summarizeTool, type ClaudeLine } from "./claude-stream";

const FIXTURES = join(__dirname, "../../../../docs/spike-2a/fixtures");

/** Replays a real recording through the parser. */
function replay(name: string): AgentEvent[] {
  const stream = new ClaudeStream("/repo");
  return readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => stream.push(JSON.parse(l) as ClaudeLine));
}

const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

const fullTexts = (events: AgentEvent[]) => {
  const texts = new Map<string, string>();
  for (const e of of(events, "text")) texts.set(e.id, (texts.get(e.id) ?? "") + e.chunk);
  return [...texts.values()];
};

describe("recorded Claude Code runs", () => {
  it("reads a two-turn edit", () => {
    const events = replay("claude-1-edit-two-turns.jsonl");
    expect(of(events, "session")[0]?.id).toBe("6b6c1839-cd5e-4f29-823c-96d075a70b64");
    expect(of(events, "turn_end")).toHaveLength(2);
    expect(of(events, "error")).toEqual([]);
    expect(of(events, "tool").map((t) => `${t.tool} ${t.text}`)).toEqual([
      "Glob **/*.js",
      "Read math.js",
      "Edit math.js",
      "Read math.js",
      "Edit math.js",
    ]);
    expect(of(events, "files_changed")).toHaveLength(2);
  });

  it("streams text in chunks and closes every message", () => {
    const events = replay("claude-1-edit-two-turns.jsonl");
    const texts = fullTexts(events);
    expect(texts[0]).toContain("Added `subtract(a, b)`");
    expect(texts).toHaveLength(2);
    expect(of(events, "text").filter((e) => e.done)).toHaveLength(2);
    expect(of(events, "text").filter((e) => !e.done).length).toBeGreaterThan(2);
  });

  it("hides Solus's own tools from the tool rows", () => {
    const tools = of(replay("claude-3-ask-user.jsonl"), "tool").map((t) => t.tool);
    expect(tools).not.toContain("mcp__solus__ask_user");
    expect(tools).toContain("Edit");
  });

  it("shows Bash output in the terminal", () => {
    const events = replay("claude-4-permission-tool.jsonl");
    expect(of(events, "terminal")[0]?.data).toContain("$ touch approved.txt");
    expect(of(events, "files_changed")).toHaveLength(1);
  });

  it("reports a refused command but still ends the turn normally", () => {
    const events = replay("claude-5-denied-no-tool.jsonl");
    expect(of(events, "tool").at(-1)).toMatchObject({ tool: "Refused", text: "Bash: touch denied.txt" });
    expect(of(events, "turn_end")).toHaveLength(1);
    expect(of(events, "error")).toEqual([]);
  });
});

describe("cases the recordings don't cover", () => {
  const stream = () => new ClaudeStream("/repo");

  it("turns a failed result into an error", () => {
    expect(stream().push({ type: "result", subtype: "success", is_error: true, result: "Invalid API key" })).toEqual([
      { type: "error", error: { message: "Invalid API key" } },
    ]);
    expect(stream().push({ type: "result", subtype: "error_during_execution", is_error: true })).toEqual([
      { type: "error", error: { message: "Claude Code stopped (error_during_execution)" } },
    ]);
  });

  it("prefers the reason in errors over a generic message", () => {
    const line = { type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found"] };
    expect(stream().push(line)).toEqual([{ type: "error", error: { message: "No conversation found" } }]);
  });

  it("ignores subagent traffic", () => {
    expect(stream().push({ type: "result", subtype: "success", parent_tool_use_id: "toolu_1" })).toEqual([]);
  });

  it("warns in the terminal when a usage limit bites", () => {
    expect(stream().push({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })).toEqual([]);
    const [event] = stream().push({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1793968800 } });
    expect(event).toMatchObject({ type: "terminal" });
  });

  it("summarises tools in a line", () => {
    expect(summarizeTool("Read", { file_path: "/repo/src/a.ts" }, "/repo")).toBe("src/a.ts");
    expect(summarizeTool("Read", { file_path: "/etc/hosts" }, "/repo")).toBe("/etc/hosts");
    expect(summarizeTool("Bash", { command: "ls\npwd" }, "/repo")).toBe("ls");
    expect(summarizeTool("Grep", { pattern: "foo" }, "/repo")).toBe("foo");
  });
});
