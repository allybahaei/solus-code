import type {
  AgentKind,
  AgentMessage,
  CallMessage,
  CreateTaskInput,
  Diff,
  MergeOptions,
  PROptions,
  Runner,
  RunnerEvent,
  RunnerMethod,
  RunnerSnapshot,
  ServerMessage,
  SetupStatus,
  MergeStrategy,
  PullRequestStatus,
  Task,
  TaskSources,
} from "@solus/core";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface RemoteRunnerOptions {
  /** For example ws://127.0.0.1:4317 */
  url: string;
  token: string;
  /** Longest wait between reconnect attempts. */
  maxRetryMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const FIRST_RETRY_MS = 250;

/**
 * A Runner that lives in a daemon. Reconnects by itself; after each connect a
 * listener on onStatus should take a fresh snapshot, because events sent while
 * disconnected are gone. Calls made while disconnected fail right away rather
 * than queueing, so nothing fires late and surprises the user.
 */
export class RemoteRunner implements Runner {
  private readonly url: string;
  private readonly maxRetryMs: number;
  private readonly listeners = new Set<(event: RunnerEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly pending = new Map<number, Pending>();
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "connecting";
  private retryMs = FIRST_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private disposed = false;

  constructor({ url, token, maxRetryMs = 5000 }: RemoteRunnerOptions) {
    this.url = `${url}/?token=${encodeURIComponent(token)}`;
    this.maxRetryMs = maxRetryMs;
    this.connect();
  }

  /** Calls the listener now with the current status, then on every change. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  /* ---------------------------- Runner API ---------------------------- */

  snapshot = () => this.call<RunnerSnapshot>("snapshot");
  checkSetup = () => this.call<SetupStatus>("checkSetup");
  listTasks = () => this.call<Task[]>("listTasks");
  getMessages = (id: string) => this.call<AgentMessage[]>("getMessages", id);
  createTask = (input: CreateTaskInput) => this.call<Task>("createTask", input);
  listSources = () => this.call<TaskSources>("listSources");
  installAgent = (agent: AgentKind) => this.call<SetupStatus>("installAgent", agent);
  getPullRequest = (id: string) => this.call<PullRequestStatus>("getPullRequest", id);
  pushPullRequest = (id: string) => this.run("pushPullRequest", id);
  mergePullRequest = (id: string, strategy: MergeStrategy) => this.run("mergePullRequest", id, strategy);
  getCheckLog = (id: string, url: string) => this.call<string>("getCheckLog", id, url);
  attachFile = (id: string, name: string, base64: string) => this.call<string>("attachFile", id, name, base64);
  startTask = (id: string) => this.run("startTask", id);
  sendMessage = (id: string, message: string, opts?: { agent?: AgentKind }) =>
    this.run("sendMessage", id, message, opts ?? {});
  answerApproval = (id: string, approvalId: string, allow: boolean) =>
    this.run("answerApproval", id, approvalId, allow);
  stopTask = (id: string) => this.run("stopTask", id);
  deleteTask = (id: string) => this.run("deleteTask", id);
  archiveTask = (id: string) => this.run("archiveTask", id);
  restoreTask = (id: string) => this.run("restoreTask", id);
  resolveConflicts = (id: string, target: string) => this.run("resolveConflicts", id, target);
  startAction = (id: string, name: string) => this.run("startAction", id, name);
  stopAction = (id: string) => this.run("stopAction", id);
  writeTerminal = (id: string, data: string) => this.run("writeTerminal", id, data);
  resizeTerminal = (id: string, cols: number, rows: number) => this.run("resizeTerminal", id, cols, rows);
  getDiff = (id: string) => this.call<Diff>("getDiff", id);
  merge = (id: string, opts: MergeOptions) => this.run("merge", id, opts);
  openPullRequest = (id: string, opts: PROptions) => this.call<{ url: string }>("openPullRequest", id, opts);

  subscribe(listener: (event: RunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ----------------------------- internals ---------------------------- */

  /** A call with no return value. */
  private async run(method: RunnerMethod, ...params: unknown[]): Promise<void> {
    await this.call<unknown>(method, ...params);
  }

  private call<T>(method: RunnerMethod, ...params: unknown[]): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected to the Solus daemon."));
    }
    const id = this.nextId++;
    const message: CallMessage = { type: "call", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify(message));
    });
  }

  private setStatus(status: ConnectionStatus) {
    if (status === this.status) return;
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private connect() {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retryMs = FIRST_RETRY_MS;
      this.setStatus("open");
    });
    socket.addEventListener("message", (e) => this.receive(String(e.data)));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const p of this.pending.values()) p.reject(new Error("Lost the connection to the Solus daemon."));
      this.pending.clear();
      if (this.disposed) return;
      this.setStatus("closed");
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
    });
  }

  private receive(raw: string) {
    const msg = JSON.parse(raw) as ServerMessage;
    if (msg.type === "event") {
      for (const l of this.listeners) l(msg.event);
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.type === "result") pending.resolve(msg.result);
    else pending.reject(new Error(msg.message));
  }
}
