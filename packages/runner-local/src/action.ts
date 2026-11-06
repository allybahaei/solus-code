import { spawn, type ChildProcess } from "node:child_process";

const KILL_AFTER_MS = 5000;

/** A saved command running in a task's worktree, such as a dev server. */
export class RunningAction {
  private readonly child: ChildProcess;
  private stopped = false;

  constructor(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    onOutput: (data: string) => void,
    onExit: (code: number | null, stopped: boolean) => void,
  ) {
    this.child = spawn(command, {
      cwd,
      shell: true,
      // Its own process group, so stopping reaches whatever it started.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, FORCE_COLOR: "1" },
    });
    const out = (d: Buffer) => onOutput(d.toString().replace(/\r?\n/g, "\r\n"));
    this.child.stdout?.on("data", out);
    this.child.stderr?.on("data", out);
    this.child.on("error", (err) => onOutput(`${err.message}\r\n`));
    this.child.on("close", (code) => onExit(code, this.stopped));
  }

  /** Asks the whole group to stop, then forces it. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.signal("SIGTERM");
    const force = setTimeout(() => this.signal("SIGKILL"), KILL_AFTER_MS);
    force.unref();
    this.child.once("close", () => clearTimeout(force));
  }

  private signal(name: NodeJS.Signals) {
    try {
      if (this.child.pid) process.kill(-this.child.pid, name);
    } catch {
      // Already gone.
    }
  }
}
