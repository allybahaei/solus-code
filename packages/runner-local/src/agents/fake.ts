import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../git";
import { slugify } from "../workspace";
import type { AgentAdapter, AgentEvent, AgentSession, AgentStart } from "./agent";

/**
 * Stands in for a real agent so the workspace, diff and storage code can be
 * tested for real. It edits real files, and its messages say that it's fake.
 *
 * Put these in a prompt to steer it: "[ask]" asks a question first, "[approve]"
 * asks to run a command first, "[fail]" errors out on its first attempt.
 */
export class FakeAgent implements AgentAdapter {
  constructor(private readonly stepMs = 300) {}

  start(options: AgentStart, emit: (event: AgentEvent) => void): AgentSession {
    return new FakeSession(options, emit, this.stepMs);
  }
}

class FakeSession implements AgentSession {
  private stopped = false;
  private nextMessage = 1;

  constructor(
    private readonly options: AgentStart,
    private readonly emit: (event: AgentEvent) => void,
    private readonly stepMs: number,
  ) {
    emit({ type: "session", id: options.session ?? `fake-${options.taskId}` });
    void this.turn(options.prompt);
  }

  send(message: string): void {
    void this.edit(message);
  }

  approve(_id: string, allow: boolean): void {
    this.say(`(Fake agent) ${allow ? "Allowed, carrying on." : "Denied, so I'll skip that."}`);
    void this.edit(this.options.prompt);
  }

  stop(): void {
    this.stopped = true;
  }

  private sleep() {
    return new Promise((r) => setTimeout(r, this.stepMs));
  }

  private say(text: string) {
    this.emit({ type: "text", id: `fake-${this.options.taskId}-${Date.now()}-${this.nextMessage++}`, chunk: text, done: true });
  }

  private async turn(prompt: string) {
    await this.sleep();
    if (this.stopped) return;
    if (prompt.includes("[fail]") && !this.options.session) {
      this.say("(Fake agent) Failing on purpose.");
      this.emit({ type: "error", error: { message: "The fake agent failed on purpose", detail: "The prompt contained [fail]." } });
      return;
    }
    if (prompt.includes("[approve]") && !this.options.session) {
      this.emit({ type: "approval", id: "fake-approval", tool: "Bash", summary: "rm -rf build" });
      return;
    }
    if (prompt.includes("[ask]") && !this.options.session) {
      this.emit({ type: "ask", question: "(Fake agent) What should the note say?" });
      return;
    }
    await this.edit(prompt);
  }

  /** Makes real changes: a new note, and a line in README.md if there is one. */
  private async edit(text: string) {
    const { cwd } = this.options;
    this.say("(Fake agent) Editing real files in this worktree. No model is involved.");
    await this.sleep();
    if (this.stopped) return;

    mkdirSync(join(cwd, "notes"), { recursive: true });
    const note = `notes/${slugify(text)}.md`;
    writeFileSync(join(cwd, note), `# Note\n\n${text}\n`);
    this.emit({ type: "tool", tool: "Write", text: note });
    if (existsSync(join(cwd, "README.md"))) {
      appendFileSync(join(cwd, "README.md"), `\nEdited by the fake agent: ${text}\n`);
      this.emit({ type: "tool", tool: "Edit", text: "README.md" });
    }
    this.emit({ type: "files_changed" });
    await this.sleep();
    if (this.stopped) return;

    const status = await git(cwd, ["status", "--short"]);
    this.emit({ type: "tool", tool: "Bash", text: "git status --short" });
    this.emit({ type: "terminal", data: `$ git status --short\r\n${status.replace(/\n/g, "\r\n")}` });
    this.say(`(Fake agent) Done. Wrote \`${note}\`.`);
    this.emit({ type: "turn_end" });
  }
}
