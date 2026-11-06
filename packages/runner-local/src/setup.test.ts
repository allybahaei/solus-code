import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSetup, describeClaudeLogin, gitIsNewEnough } from "./setup";

let dir: string;
const saved = { CLAUDECODE: process.env.CLAUDECODE, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solus-setup-"));
  Reflect.deleteProperty(process.env, "CLAUDECODE");
  Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  }
});

function tool(name: string, script: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

const healthy = () => ({
  git: tool("git", "echo git version 2.49.0"),
  gh: tool("gh", "exit 0"),
  claude: tool("claude", `echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}'`),
  codex: tool("codex", "echo Logged in using ChatGPT"),
  opencode: tool("opencode", "echo Anthropic stored"),
});

describe("checkSetup", () => {
  it("reports everything ready, and how Claude will be billed", async () => {
    const { agents, tools } = await checkSetup(healthy());
    expect(agents.map((a) => a.state)).toEqual(["ready", "ready", "ready"]);
    expect(tools.map((t) => t.state)).toEqual(["ready", "ready"]);
    expect(agents[0]?.detail).toContain("Claude Pro plan");
    expect(agents[1]?.detail).toBe("Logged in using ChatGPT");
  });

  it("says how to install what's missing", async () => {
    const nope = join(dir, "nope");
    const { agents, tools } = await checkSetup({ git: nope, gh: nope, claude: nope, codex: nope, opencode: nope });
    expect(agents.map((a) => [a.state, a.fix])).toEqual([
      ["missing", "npm i -g @anthropic-ai/claude-code"],
      ["missing", "npm i -g @openai/codex"],
      ["missing", "npm i -g opencode-ai"],
    ]);
    expect(tools.map((t) => t.state)).toEqual(["missing", "missing"]);
  });

  it("says how to sign in", async () => {
    const { agents, tools } = await checkSetup({
      ...healthy(),
      gh: tool("gh", "exit 1"),
      claude: tool("claude", `echo '{"loggedIn":false}'; exit 1`),
      codex: tool("codex", "exit 1"),
      opencode: tool("opencode", "exit 1"),
    });
    expect(agents.map((a) => [a.state, a.fix])).toEqual([
      ["signed_out", "claude auth login"],
      ["signed_out", "codex login"],
      ["ready", undefined],
    ]);
    expect(tools[1]).toMatchObject({ state: "signed_out", fix: "gh auth login" });
  });

  it("treats unreadable output as signed out", async () => {
    const { agents } = await checkSetup({ ...healthy(), claude: tool("claude", "echo not json") });
    expect(agents[0]?.state).toBe("signed_out");
  });

  it("flags a git too old for merging", async () => {
    const { tools } = await checkSetup({ ...healthy(), git: tool("git", "echo git version 2.30.1") });
    expect(tools[0]).toMatchObject({ state: "problem" });
  });

  it("explains running inside Claude Code, without calling claude", async () => {
    process.env.CLAUDECODE = "1";
    const { agents } = await checkSetup(healthy());
    expect(agents[0]).toMatchObject({ state: "problem", fix: "Start Solus from a normal terminal" });
  });

  it("warns when an API key may change the billing", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const { agents } = await checkSetup(healthy());
    expect(agents[0]?.detail).toContain("ANTHROPIC_API_KEY");
  });
});

it("compares git versions by number", () => {
  expect(gitIsNewEnough("git version 2.38.0")).toBe(true);
  expect(gitIsNewEnough("git version 2.100.1")).toBe(true);
  expect(gitIsNewEnough("git version 3.0.0")).toBe(true);
  expect(gitIsNewEnough("git version 2.37.9")).toBe(false);
});

it("describes each kind of Claude login", () => {
  expect(describeClaudeLogin({ authMethod: "claude.ai", subscriptionType: "max" })).toContain("Max plan");
  expect(describeClaudeLogin({ authMethod: "claude.ai" })).toContain("Claude account");
  expect(describeClaudeLogin({ authMethod: "api_key" })).toContain("API key");
});
