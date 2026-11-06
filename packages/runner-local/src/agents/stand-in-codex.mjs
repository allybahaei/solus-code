// A stand-in `codex` for tests. Speaks `exec --json` and drives the real MCP bridge.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
appendFileSync(process.env.STAND_IN_LOG, JSON.stringify({ argv, stdin: process.stdin.isTTY ?? null }) + "\n");

const config = Object.fromEntries(
  argv.flatMap((a, i) => {
    if (argv[i - 1] !== "-c") return [];
    const at = a.indexOf("=");
    return [[a.slice(0, at), JSON.parse(a.slice(at + 1))]];
  }),
);
const positional = argv.slice(argv.indexOf("--") + 1);
const resume = argv[1] === "resume";
const thread = resume ? positional[0] : "thread-1";
const prompt = positional.at(-1);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (thread === "gone") {
  process.stderr.write("Error: thread/resume: thread/resume failed: no rollout found for thread id gone (code -32600)\n");
  process.exit(1);
}

function askThroughBridge(question) {
  const bridge = spawn(config["mcp_servers.solus.command"], config["mcp_servers.solus.args"], {
    env: { ...process.env, SOLUS_SOCKET: config["mcp_servers.solus.env.SOLUS_SOCKET"] },
    stdio: ["pipe", "pipe", "inherit"],
  });
  return new Promise((resolve) => {
    createInterface({ input: bridge.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        bridge.kill();
        resolve(msg.result.content[0].text);
      }
    });
    bridge.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_user", arguments: { question } } }) + "\n",
    );
  });
}

out({ type: "thread.started", thread_id: thread });
out({ type: "turn.started" });
if (prompt.includes("[crash]")) {
  process.stderr.write("something broke\n");
  process.exit(3);
}
if (prompt.includes("[fail]")) {
  out({ type: "error", message: "Your login expired." });
  out({ type: "turn.failed", error: { message: "Your login expired." } });
  process.exit(1);
}
if (prompt.includes("[expired]")) {
  out({ type: "turn.failed", error: { message: "Your refresh token was already used. Please log out and sign in again." } });
  process.exit(1);
}
if (prompt.includes("[hang]")) await new Promise(() => setInterval(() => {}, 1000));
if (prompt.includes("[slow]")) await new Promise((r) => setTimeout(r, 300));
if (prompt.includes("[ask]")) await askThroughBridge("Which one?");
out({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: `Heard: ${prompt.split("\n").at(-1)}` } });
out({ type: "turn.completed", usage: {} });
