import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type * as NodePtyModule from "node-pty";
import type { IPty } from "node-pty";

const require = createRequire(import.meta.url);

type NodePty = typeof NodePtyModule;
let loaded: NodePty | undefined;

/**
 * Loads node-pty on first use, so a machine without a working native build
 * only loses the terminal. Its spawn-helper ships without the executable bit
 * when install scripts are blocked, as pnpm does by default.
 */
function nodePty(): NodePty {
  if (loaded) return loaded;
  try {
    const root = dirname(require.resolve("node-pty/package.json"));
    try {
      chmodSync(join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"), 0o755);
    } catch {
      // No prebuilt helper here, as on Windows or a source build.
    }
    loaded = require("node-pty") as NodePty;
    return loaded;
  } catch (err) {
    throw new Error("The interactive terminal isn't available on this machine.", { cause: err });
  }
}

export interface ShellSize {
  cols: number;
  rows: number;
}

/** The user's own shell, running in a worktree. */
export class WorkspaceShell {
  private readonly pty: IPty;

  constructor(cwd: string, size: ShellSize, onData: (data: string) => void, onExit: () => void) {
    this.pty = nodePty().spawn(process.env.SHELL ?? "/bin/sh", [], {
      name: "xterm-256color",
      cwd,
      cols: size.cols,
      rows: size.rows,
      env: process.env as Record<string, string>,
    });
    this.pty.onData(onData);
    this.pty.onExit(onExit);
  }

  write(data: string) {
    this.pty.write(data);
  }

  resize({ cols, rows }: ShellSize) {
    this.pty.resize(cols, rows);
  }

  kill() {
    this.pty.kill();
  }
}
