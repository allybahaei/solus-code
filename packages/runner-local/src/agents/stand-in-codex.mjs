// A stand-in `codex` for tests. Speaks `app-server` JSON-RPC and drives the real MCP bridge.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const log = (entry) => appendFileSync(process.env.STAND_IN_LOG, JSON.stringify(entry) + "\n");
log({ argv });

const config = Object.fromEntries(
  argv.flatMap((a, i) => {
    if (argv[i - 1] !== "-c") return [];
    const at = a.indexOf("=");
    return [[a.slice(0, at), JSON.parse(a.slice(at + 1))]];
  }),
);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const notify = (method, params) => out({ method, params });
const answers = new Map();
let serverRequest = 1000;
let turns = 0;

if (argv[0] !== "app-server") {
  process.stderr.write("error: unrecognized subcommand 'app-server'\n");
  process.exit(2);
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

/** A request to Solus. Resolves with its reply. */
function request(method, params) {
  const id = ++serverRequest;
  out({ id, method, params });
  return new Promise((resolve) => answers.set(id, resolve));
}

const finish = (turn, status = "completed", error = null) => notify("turn/completed", { threadId: "thread-1", turn: { id: turn, status, error } });

async function runTurn(turn, prompt) {
  const itemId = `msg_${turn}`;
  if (prompt.includes("[crash]")) {
    process.stderr.write("something broke\n");
    process.exit(3);
  }
  if (prompt.includes("[fail]")) {
    notify("error", { error: { message: "Your login expired." }, willRetry: false });
    return finish(turn, "failed", { message: "Your login expired." });
  }
  if (prompt.includes("[expired]")) {
    return finish(turn, "failed", { message: "Your refresh token was already used. Please log out and sign in again." });
  }
  if (prompt.includes("[hang]")) return;
  if (prompt.includes("[slow]")) await new Promise((r) => setTimeout(r, 300));
  if (prompt.includes("[ask]")) await askThroughBridge("Which one?");
  if (prompt.includes("[token]")) log({ tokenReply: await request("account/chatgptAuthTokens/refresh", {}) });
  if (prompt.includes("[approve]")) {
    const reply = await request("item/commandExecution/requestApproval", { command: "/bin/zsh -lc 'curl example.com'", itemId: "c1" });
    log({ decision: reply.result?.decision });
  }
  if (prompt.includes("[whole]")) {
    notify("item/completed", { item: { id: itemId, type: "agentMessage", text: "All at once" } });
  } else {
    notify("item/started", { item: { id: itemId, type: "agentMessage", text: "" } });
    for (const delta of ["Heard: ", prompt]) notify("item/agentMessage/delta", { itemId, delta });
    notify("item/completed", { item: { id: itemId, type: "agentMessage", text: `Heard: ${prompt}` } });
  }
  finish(turn);
}

createInterface({ input: process.stdin }).on("line", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id !== undefined && !msg.method) return answers.get(msg.id)?.(msg);
  log({ method: msg.method, params: msg.params });
  if (msg.method === "initialize") return out({ id: msg.id, result: { userAgent: "stand-in" } });
  if (msg.method === "thread/start") return out({ id: msg.id, result: { thread: { id: "thread-1" } } });
  if (msg.method === "thread/resume") {
    if (msg.params.threadId === "gone") return out({ id: msg.id, error: { code: -32600, message: "no rollout found for thread id gone" } });
    return out({ id: msg.id, result: { thread: { id: msg.params.threadId } } });
  }
  if (msg.method === "turn/start") {
    const turn = `turn-${++turns}`;
    out({ id: msg.id, result: { turn: { id: turn, status: "inProgress" } } });
    void runTurn(turn, msg.params.input[0].text);
  }
});
