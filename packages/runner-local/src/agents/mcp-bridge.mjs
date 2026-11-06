// A tiny MCP server over stdio, started by the agent. It offers Solus's tools and
// forwards each call to the daemon over the unix socket in SOLUS_SOCKET.
// Plain JavaScript with no dependencies, because the agent runs it directly.
import { connect } from "node:net";
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

const tools = [
  {
    name: "ask_user",
    description:
      "Ask the human a question when you need a decision you can't make yourself. Then end your turn; their answer arrives as your next message.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The question, in one or two sentences." } },
      required: ["question"],
    },
  },
  {
    name: "approve",
    description: "Internal: decides whether a tool call may run.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
    },
  },
];

/** Forwards one tool call and resolves with the daemon's text reply. */
function forward(tool, args) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.SOLUS_SOCKET);
    socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify({ tool, args }) + "\n"));
    createInterface({ input: socket }).once("line", (line) => {
      socket.end();
      resolve(JSON.parse(line).text);
    });
  });
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: msg.id, result });

  if (msg.method === "initialize") {
    reply({
      protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "solus", version: "0.0.0" },
    });
  } else if (msg.method === "tools/list") {
    reply({ tools });
  } else if (msg.method === "tools/call") {
    try {
      const text = await forward(msg.params.name, msg.params.arguments ?? {});
      reply({ content: [{ type: "text", text }] });
    } catch (err) {
      reply({ content: [{ type: "text", text: `Solus couldn't handle this: ${err.message}` }], isError: true });
    }
  } else {
    reply({});
  }
});
