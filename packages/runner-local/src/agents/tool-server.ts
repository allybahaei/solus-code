import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** The MCP server an agent starts, which forwards tool calls to this ToolServer. */
export const BRIDGE = fileURLToPath(new URL("./mcp-bridge.mjs", import.meta.url));

/**
 * Agents start the bridge with process.execPath. Inside the Mac app that is the
 * app itself, which only behaves as plain Node with this set.
 */
export function bridgeEnv(versions: NodeJS.ProcessVersions = process.versions): Record<string, string> {
  return versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
}

const ASK_REPLY = "Your question is on the person's screen. End your turn now; their answer arrives as your next message.";

export interface ToolHandlers {
  onAsk: (question: string) => void;
  onBranchName?: (name: string) => void;
  /** Keep the socket: answer with ToolServer.reply once the person decides. */
  onApproval?: (socket: Socket, args: Record<string, unknown>) => void;
}

/** A private unix socket that the bridge connects to for each tool call. */
export class ToolServer {
  /** A folder only this user can read, for the socket and any config files. */
  readonly dir = mkdtempSync(join(tmpdir(), "solus-"));
  readonly socketPath = join(this.dir, "s");
  private readonly server: Server;

  constructor(handlers: ToolHandlers) {
    this.server = createServer((socket) => {
      socket.on("error", () => {});
      createInterface({ input: socket }).once("line", (line) => {
        const { tool, args } = JSON.parse(line) as { tool: string; args: Record<string, unknown> };
        if (tool === "ask_user") {
          // Returns at once rather than blocking, so a person can take as long as
          // they like, and the question survives a restart.
          handlers.onAsk(String(args.question ?? "The agent has a question."));
          ToolServer.reply(socket, ASK_REPLY);
        } else if (tool === "set_branch_name") {
          handlers.onBranchName?.(String(args.name ?? ""));
          ToolServer.reply(socket, "Thanks. Carry on.");
        } else if (tool === "approve") {
          handlers.onApproval?.(socket, args);
        }
      });
    });
    this.server.listen(this.socketPath);
  }

  static reply(socket: Socket, text: string) {
    socket.write(JSON.stringify({ text }) + "\n");
  }

  close() {
    this.server.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
