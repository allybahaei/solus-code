import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, Notification, app, dialog, ipcMain, safeStorage, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { startDaemon, type Daemon } from "@solus/daemon";
import { LocalRunner, adapterFor } from "@solus/runner-local";
import { problemReportUrl, type Task } from "@solus/core";
import { AccountClient, SignInCancelled, SignInError, pkcePair, type Account, type AuthConfig } from "./account";
import { listenForCode, type PendingCallback } from "./callback";
import { alertFor, attentionCount } from "./alerts";
import { isNewer, latestRelease } from "./updates";
import { readRecents, remember, writeRecents, type RecentRepo } from "./recents";
import { loginShellPath, mergePath } from "./shell-path";
import { clearAccount, loadAccount, saveAccount } from "./session-store";
import { signInPage, welcomePage, type SignInStep } from "./welcome";

/** Set when building a release. Builds without it need no account. */
declare const __SOLUS_AUTH__: AuthConfig | null;

/** One open repo: its own runner, daemon and window. */
interface RepoWindow {
  path: string;
  runner: LocalRunner;
  daemon: Daemon;
  window: BrowserWindow;
  closing: boolean;
}

const BACKGROUND = "#1f1d1b";
/** No title bar: the page's top bars run behind the window buttons, centred on them. */
const TITLE_BAR = { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 15 } } as const;
/** Fixed, because Supabase only returns to addresses on its allow list. */
const CALLBACK_PORT = 47831;
const staticDir = fileURLToPath(new URL("../web", import.meta.url));
const open = new Map<string, RepoWindow>();
let welcome: BrowserWindow | undefined;
let quitting = false;

const accounts = __SOLUS_AUTH__ ? new AccountClient(__SOLUS_AUTH__) : undefined;
let account: Account | undefined;
let signIn: SignInStep = {};
let pendingSignIn: PendingCallback<Account> | undefined;
const needsSignIn = () => accounts !== undefined && account === undefined;

const recentsFile = () => join(app.getPath("userData"), "recents.json");
const accountFile = () => join(app.getPath("userData"), "account.bin");

function updateRecents(change: (recents: RecentRepo[]) => RecentRepo[]) {
  writeRecents(recentsFile(), change(readRecents(recentsFile())));
  buildMenu();
}

function openExternally(url: string) {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

/** Tries the port this repo used last, so its saved settings stay with it. */
async function startOn(runner: LocalRunner, token: string, port: number | undefined): Promise<Daemon> {
  try {
    return await startDaemon({ runner, token, staticDir, ...(port ? { port } : {}) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    return startDaemon({ runner, token, staticDir });
  }
}

async function openRepo(chosen: string) {
  if (needsSignIn()) return showWelcome();
  const already = open.get(chosen);
  if (already) return already.window.focus();

  let runner: LocalRunner | undefined;
  try {
    const home = process.env.SOLUS_HOME;
    runner = await LocalRunner.open({ repoPath: chosen, adapterFor, ...(home ? { home } : {}) });
    const { repo } = await runner.snapshot();
    const path = repo.path ?? chosen;
    const token = randomBytes(24).toString("hex");
    const known = readRecents(recentsFile()).find((r) => r.path === path);
    const daemon = await startOn(runner, token, known?.port);
    const entry = repoWindow(path, runner, daemon, `http://127.0.0.1:${daemon.port}`, token);
    open.set(path, entry);
    runner.subscribe((event) => {
      if (event.type === "task.state_changed") void alert(entry, event.task);
      if (event.type === "task.deleted" || event.type === "task.state_changed") void updateBadge();
    });
    void updateBadge();
    updateRecents((recents) => remember(recents, { path, port: daemon.port }));
    welcome?.close();
  } catch (err) {
    runner?.dispose();
    dialog.showErrorBox(`Couldn't open ${basename(chosen)}`, err instanceof Error ? err.message : String(err));
    if (open.size === 0) showWelcome();
  }
}

function repoWindow(path: string, runner: LocalRunner, daemon: Daemon, origin: string, token: string): RepoWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: basename(path),
    backgroundColor: BACKGROUND,
    ...TITLE_BAR,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      additionalArguments: [`--solus-version=${app.getVersion()}`, `--solus-platform=${platformName()}`],
    },
  });
  const entry: RepoWindow = { path, runner, daemon, window, closing: false };

  window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    openExternally(url);
  });
  window.on("close", (event) => {
    if (entry.closing || quitting) return;
    event.preventDefault();
    void confirmStop([entry]).then((ok) => {
      if (!ok) return;
      entry.closing = true;
      window.close();
    });
  });
  window.on("closed", () => {
    open.delete(path);
    stop(entry);
    void updateBadge();
    if (!quitting && open.size === 0) showWelcome();
  });

  void window.loadURL(`${origin}/#token=${token}`);
  return entry;
}

/** Tells the person a task needs them, unless they're looking at it. */
async function alert(entry: RepoWindow, task: Task) {
  const message = alertFor(task);
  if (!message || entry.window.isFocused()) return;
  const { notifications, sound } = await entry.runner.getSettings();
  if (!notifications) return;
  const shown = new Notification({ ...message, silent: !sound, ...(sound ? { sound: "Glass" } : {}) });
  shown.on("click", () => {
    entry.window.show();
    entry.window.focus();
    void entry.window.webContents.executeJavaScript(`location.hash=${JSON.stringify(`task=${task.id}`)}`);
  });
  shown.show();
}

async function updateBadge() {
  const tasks = await Promise.all([...open.values()].map((entry) => entry.runner.listTasks()));
  const count = attentionCount(tasks.flat());
  app.dock?.setBadge(count > 0 ? String(count) : "");
}

const UPDATE_EVERY_MS = 6 * 60 * 60_000;

/** "macOS 26.4.0 (arm64)". Asked of the system: Darwin's numbering doesn't map onto macOS's. */
function platformName(): string {
  return process.platform === "darwin" ? `macOS ${process.getSystemVersion()} (${process.arch})` : `${process.platform} (${process.arch})`;
}

function reportProblem() {
  void shell.openExternal(problemReportUrl({ version: app.getVersion(), platform: platformName() }));
}

/** Tells the person when a newer Solus is out. Installing it themselves until updates can be signed. */
async function checkForUpdates(manual: boolean) {
  try {
    const latest = await latestRelease();
    if (latest && isNewer(app.getVersion(), latest.version)) {
      const { response } = await dialog.showMessageBox({
        message: `Solus ${latest.version} is available`,
        detail: `You have ${app.getVersion()}. Download the new version, then replace this one in Applications.`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openExternal(latest.url);
    } else if (manual) {
      await dialog.showMessageBox({ message: "Solus is up to date", detail: `You have ${app.getVersion()}.` });
    }
  } catch (err) {
    if (manual) dialog.showErrorBox("Couldn't check for updates", err instanceof Error ? err.message : String(err));
  }
}

/** Only Solus's own repo windows may ask the app for anything. */
function fromRepoWindow(event: IpcMainInvokeEvent): boolean {
  return [...open.values()].some((entry) => entry.window.webContents === event.sender);
}

function stop(entry: RepoWindow) {
  entry.runner.dispose();
  void entry.daemon.close();
}

async function busyTasks(entry: RepoWindow): Promise<number> {
  const { tasks } = await entry.runner.snapshot();
  return tasks.filter((task) => task.state === "working" || task.state === "needs_input").length;
}

/** Closing a window stops its agents, so ask first when any are running. */
async function confirmStop(entries: RepoWindow[]): Promise<boolean> {
  const counts = await Promise.all(entries.map(busyTasks));
  const busy = counts.reduce((sum, n) => sum + n, 0);
  if (busy === 0) return true;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: busy === 1 ? "An agent is still running" : `${busy} agents are still running`,
    detail: "Closing stops them. Their work and chats are kept, and you can restart them later.",
    buttons: ["Stop and close", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

function showWelcome() {
  const window = welcome ?? welcomeWindow();
  const page = needsSignIn() ? signInPage(signIn) : welcomePage(readRecents(recentsFile()));
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  window.focus();
}

function welcomeWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 560,
    height: 520,
    resizable: false,
    title: "Solus",
    backgroundColor: BACKGROUND,
    ...TITLE_BAR,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  welcome = window;
  window.on("page-title-updated", (event) => event.preventDefault());
  window.on("closed", () => {
    welcome = undefined;
  });
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    void followLink(new URL(url));
  });
  return window;
}

/** Links on the Welcome window, which has no other way to reach here. */
async function followLink(url: URL) {
  if (url.protocol !== "solus:") return;
  if (url.host === "github") return signInWithGitHub();
  if (url.host === "cancel") return pendingSignIn?.cancel();
  if (url.host === "open") return chooseRepo();
  const repo = url.host === "recent" ? readRecents(recentsFile())[Number(url.pathname.slice(1))] : undefined;
  if (repo) await openRepo(repo.path);
}

async function signInWithGitHub() {
  if (!accounts) return;
  // "Open GitHub again" starts over, so only the newest browser tab can finish.
  const earlier = pendingSignIn;
  pendingSignIn = undefined;
  earlier?.cancel();
  await earlier?.result.catch(() => undefined);

  const { verifier, challenge } = pkcePair();
  let pending: PendingCallback<Account>;
  try {
    pending = await listenForCode(CALLBACK_PORT, (code) => accounts.exchangeCode(code, verifier));
  } catch (err) {
    return signInFailed(err);
  }
  pendingSignIn = pending;
  signIn = { waiting: true };
  showWelcome();

  try {
    const url = accounts.authorizeUrl(`http://127.0.0.1:${CALLBACK_PORT}/callback`, challenge);
    const [signedIn] = await Promise.all([pending.result, shell.openExternal(url)]);
    pendingSignIn = undefined;
    account = signedIn;
    signIn = {};
    saveAccount(accountFile(), signedIn, safeStorage);
    buildMenu();
    app.focus({ steal: true });
    await restoreOrWelcome();
  } catch (err) {
    pending.cancel();
    if (pendingSignIn !== pending) return; // A newer attempt took over.
    pendingSignIn = undefined;
    signInFailed(err);
  }
}

function signInFailed(err: unknown) {
  if (err instanceof SignInCancelled) signIn = {};
  else signIn = { error: err instanceof SignInError ? err.message : "Something went wrong. Try again." };
  showWelcome();
}

async function signOut() {
  const entries = [...open.values()];
  if (!account || !(await confirmStop(entries))) return;
  const leaving = account;
  account = undefined;
  clearAccount(accountFile());
  buildMenu();
  for (const entry of entries) {
    entry.closing = true;
    entry.window.close();
  }
  if (entries.length === 0) showWelcome();
  await accounts?.signOut(leaving);
}

async function chooseRepo() {
  if (needsSignIn()) return showWelcome();
  const { canceled, filePaths } = await dialog.showOpenDialog({
    message: "Choose a git repository",
    buttonLabel: "Open",
    properties: ["openDirectory"],
  });
  const [path] = filePaths;
  if (!canceled && path) await openRepo(path);
}

function accountMenu(): MenuItemConstructorOptions[] {
  if (!account) return [];
  return [
    { label: `Signed in as ${account.email}`, enabled: false },
    { label: "Sign Out", click: () => void signOut() },
    { type: "separator" },
  ];
}

function buildMenu() {
  const recents: MenuItemConstructorOptions[] = readRecents(recentsFile()).map((repo) => ({
    label: basename(repo.path),
    click: () => void openRepo(repo.path),
  }));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          { label: "Open Repository…", accelerator: "CmdOrCtrl+O", click: () => void chooseRepo() },
          {
            label: "Open Recent",
            enabled: recents.length > 0,
            submenu: [
              ...recents,
              { type: "separator" },
              { label: "Clear Menu", click: () => updateRecents((list) => list.filter((r) => open.has(r.path))) },
            ],
          },
          { type: "separator" },
          ...accountMenu(),
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { label: "Report a Problem…", click: reportProblem },
          { label: "Check for Updates…", click: () => void checkForUpdates(true) },
        ],
      },
    ]),
  );
}

async function restoreOrWelcome() {
  if (needsSignIn()) return showWelcome();
  for (const repo of readRecents(recentsFile()).filter((r) => r.open)) await openRepo(repo.path);
  if (open.size === 0) showWelcome();
}

async function main() {
  if (!app.requestSingleInstanceLock()) return app.quit();

  process.env.PATH = mergePath(await loginShellPath(process.env.SHELL ?? "/bin/zsh"), process.env.PATH ?? "", homedir());

  app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.focus());
  app.on("activate", () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) showWelcome();
  });
  // Stay open with no windows, as Mac apps do; the Welcome window comes back.
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    const entries = [...open.values()];
    void confirmStop(entries).then((ok) => {
      if (!ok) return;
      quitting = true;
      updateRecents((recents) => recents.map((repo) => ({ ...repo, open: open.has(repo.path) })));
      entries.forEach(stop);
      // Not in this tick: Electron is still finishing the quit we cancelled.
      setImmediate(() => app.quit());
    });
  });

  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => {
    allow(permission === "clipboard-sanitized-write");
  });
  if (accounts) account = loadAccount(accountFile(), safeStorage);
  ipcMain.handle("solus:test-notification", (event) => {
    if (!fromRepoWindow(event) || !Notification.isSupported()) return false;
    new Notification({ title: "Notifications are on", body: "Solus will tell you here when a task needs you.", sound: "Glass" }).show();
    return true;
  });
  ipcMain.handle("solus:check-updates", (event) => {
    if (fromRepoWindow(event)) return checkForUpdates(true);
  });
  buildMenu();
  await restoreOrWelcome();
  if (app.isPackaged) {
    setTimeout(() => void checkForUpdates(false), 15_000);
    setInterval(() => void checkForUpdates(false), UPDATE_EVERY_MS);
  }
}

void main();
