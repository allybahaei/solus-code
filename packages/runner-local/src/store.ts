import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage, DiffFile, Task } from "@solus/core";

/** A task plus what only the runner needs to know about it. */
export interface StoredTask {
  task: Task;
  /** Absolute path, once the workspace exists. */
  worktree?: string;
  /** The repo's setup command has finished in this worktree. */
  setupDone?: boolean;
  /** The agent's own session id, once it has run, for resuming. */
  agentSession?: string;
}

/** Reads a JSONL file, skipping a last line left half-written by a crash. */
function readLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Ignore it. Anything before it is intact.
    }
  }
  return out;
}

/**
 * Saved state for one repo. Tasks are one small JSON file, replaced atomically;
 * conversations and terminal output are append-only, one file per task.
 */
export class TaskStore {
  private readonly tasksFile: string;
  private readonly messagesDir: string;
  private readonly terminalDir: string;
  private readonly diffsDir: string;

  constructor(dir: string) {
    this.tasksFile = join(dir, "tasks.json");
    this.messagesDir = join(dir, "messages");
    this.terminalDir = join(dir, "terminal");
    this.diffsDir = join(dir, "diffs");
    mkdirSync(this.messagesDir, { recursive: true });
    mkdirSync(this.terminalDir, { recursive: true });
    mkdirSync(this.diffsDir, { recursive: true });
  }

  loadTasks(): StoredTask[] {
    if (!existsSync(this.tasksFile)) return [];
    return JSON.parse(readFileSync(this.tasksFile, "utf8")) as StoredTask[];
  }

  saveTasks(tasks: StoredTask[]): void {
    const tmp = `${this.tasksFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    renameSync(tmp, this.tasksFile);
  }

  loadMessages(id: string): AgentMessage[] {
    return readLines(join(this.messagesDir, `${id}.jsonl`));
  }

  appendMessage(message: AgentMessage): void {
    appendFileSync(join(this.messagesDir, `${message.taskId}.jsonl`), JSON.stringify(message) + "\n");
  }

  /** Keeps a diff whose worktree is about to go, for read-only review. */
  saveDiff(id: string, files: DiffFile[]): void {
    writeFileSync(join(this.diffsDir, `${id}.json`), JSON.stringify(files));
  }

  loadDiff(id: string): DiffFile[] {
    const path = join(this.diffsDir, `${id}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DiffFile[]) : [];
  }

  loadTerminal(id: string): string[] {
    return readLines(join(this.terminalDir, `${id}.jsonl`));
  }

  appendTerminal(id: string, data: string): void {
    appendFileSync(join(this.terminalDir, `${id}.jsonl`), JSON.stringify(data) + "\n");
  }
}
