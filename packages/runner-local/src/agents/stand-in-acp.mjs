// A stand-in ACP agent for tests. Shapes match docs/spike-5/findings.md.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = (o) => appendFileSync(process.env.STAND_IN_LOG, JSON.stringify(o) + "\n");
const out = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
const update = (u) => out({ method: "session/update", params: { sessionId: "ses-1", update: u } });
const options = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
];
let bridge;
let permissionId = 1000;
const permissions = new Map();

function askThroughBridge(question) {
  const bridgeProc = spawn(bridge.command, bridge.args, {
    env: { ...process.env, ...Object.fromEntries(bridge.env.map((e) => [e.name, e.value])) },
    stdio: ["pipe", "pipe", "inherit"],
  });
  return new Promise((resolve) => {
    createInterface({ input: bridgeProc.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        bridgeProc.kill();
        resolve();
      }
    });
    bridgeProc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_user", arguments: { question } } }) + "\n",
    );
  });
}

function askPermission(command) {
  const id = ++permissionId;
  const toolCall = { toolCallId: "call-1", name: "shell", kind: "execute", title: command, status: "pending", rawInput: { command } };
  update({ sessionUpdate: "tool_call", ...toolCall, title: "shell" });
  out({ id, method: "session/request_permission", params: { sessionId: "ses-1", toolCall, options } });
  return new Promise((resolve) => permissions.set(id, resolve));
}

async function prompt(id, text) {
  log({ prompt: text });
  if (text.includes("[crash]")) {
    process.stderr.write("something broke\n");
    process.exit(3);
  }
  if (text.includes("[signed-out]")) {
    out({ id, error: { code: -32000, message: "Authentication required" } });
    return;
  }
  if (text.includes("[hang]")) return;
  if (text.includes("[ask]")) await askThroughBridge("Which colour?");
  if (text.includes("[approve]")) {
    const { outcome } = await askPermission("curl example.com");
    log({ decision: outcome });
    if (outcome.optionId === "once") {
      update({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed", title: "curl example.com" });
    } else {
      update({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "failed" });
    }
  }
  update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
  update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Hel" } });
  update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "lo" } });
  out({ id, result: { stopReason: text.includes("[refuse]") ? "refusal" : "end_turn" } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && !msg.method) {
    permissions.get(msg.id)?.(msg.result);
    permissions.delete(msg.id);
    return;
  }
  log({ method: msg.method, sessionId: msg.params?.sessionId });
  switch (msg.method) {
    case "initialize":
      out({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
      break;
    case "session/new":
      [bridge] = msg.params.mcpServers;
      out({ id: msg.id, result: { sessionId: "ses-1" } });
      break;
    case "session/load":
      [bridge] = msg.params.mcpServers;
      if (msg.params.sessionId === "gone") {
        out({ id: msg.id, error: { code: -32002, message: "Session not found" } });
        break;
      }
      // The history replays here, and must not reach the chat again.
      update({ sessionUpdate: "agent_message_chunk", messageId: "old", content: { type: "text", text: "old reply" } });
      out({ id: msg.id, result: {} });
      break;
    case "session/prompt":
      void prompt(msg.id, msg.params.prompt[0].text);
      break;
    default:
      out({ id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
