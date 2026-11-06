// A stand-in `claude` for tests. Speaks stream-json and drives the real MCP bridge.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const value = (flag) => argv[argv.indexOf(flag) + 1];
appendFileSync(process.env.STAND_IN_LOG, JSON.stringify({ argv, env: { MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT } }) + "\n");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const session_id = value("--resume") ?? value("--session-id");
const result = (o = {}) => out({ type: "result", subtype: "success", is_error: false, ...o });
const say = (text, id) => {
  out({ type: "stream_event", event: { type: "message_start", message: { id } } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } });
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
  out({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
};

/** Calls a Solus tool through the real bridge, as Claude Code would. */
function callTool(name, args) {
  const server = JSON.parse(readFileSync(value("--mcp-config"), "utf8")).mcpServers.solus;
  const bridge = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "inherit"] });
  return new Promise((resolve) => {
    createInterface({ input: bridge.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        bridge.kill();
        resolve(msg.result.content[0].text);
      }
    });
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
}

out({ type: "system", subtype: "init", session_id });
let turn = 0;
createInterface({ input: process.stdin }).on("line", async (line) => {
  const text = JSON.parse(line).message.content[0].text;
  turn++;
  if (text.includes("[crash]")) {
    process.stderr.write("something broke\n");
    process.exit(3);
  }
  if (text.includes("[hang]")) return;
  if (text.includes("[ask]")) {
    const reply = await callTool("ask_user", { question: "Which one?" });
    say(`Tool said: ${reply}`, `m${turn}`);
    result();
    return;
  }
  if (text.includes("[approve]")) {
    const decision = await callTool("approve", { tool_name: "Bash", input: { command: "rm -rf build" } });
    say(`Decision: ${decision}`, `m${turn}`);
    result();
    return;
  }
  say(`Heard: ${text}`, `m${turn}`);
  result();
});
