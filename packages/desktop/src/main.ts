import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, app, dialog, safeStorage, session, shell, type MenuItemConstructorOptions } from "electron";
import { startDaemon, type Daemon } from "@solus/daemon";
import { LocalRunner, adapterFor } from "@solus/runner-local";
import { AccountClient, SignInError, type Account, type AuthConfig } from "./account";
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
const staticDir = fileURLToPath(new URL("../web", import.meta.url));
const open = new Map<string, RepoWindow>();
let welcome: BrowserWindow | undefined;
let quitting = false;

const accounts = __SOLUS_AUTH__ ? new AccountClient(__SOLUS_AUTH__) : undefined;
let account: Account | undefined;
let signIn: SignInStep = {};
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
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
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
    if (!quitting && open.size === 0) showWelcome();
  });

  void window.loadURL(`${origin}/#token=${token}`);
  return entry;
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

/** Links and forms on the Welcome window, which has no other way to reach here. */
async function followLink(url: URL) {
  if (url.protocol !== "solus:") return;
  if (url.host === "email") return requestCode(url.searchParams.get("email")?.trim() ?? "");
  if (url.host === "resend") return requestCode(signIn.codeSentTo ?? "");
  if (url.host === "code") return submitCode(url.searchParams.get("code") ?? "");
  if (url.host === "change-email") {
    signIn = { ...(signIn.codeSentTo ? { email: signIn.codeSentTo } : {}) };
    return showWelcome();
  }
  if (url.host === "open") return chooseRepo();
  const repo = url.host === "recent" ? readRecents(recentsFile())[Number(url.pathname.slice(1))] : undefined;
  if (repo) await openRepo(repo.path);
}

function signInFailed(err: unknown, step: SignInStep) {
  signIn = { ...step, error: err instanceof SignInError ? err.message : "Something went wrong. Try again." };
  showWelcome();
}

async function requestCode(email: string) {
  try {
    await accounts?.sendCode(email);
    signIn = { codeSentTo: email };
    showWelcome();
  } catch (err) {
    signInFailed(err, signIn.codeSentTo ? { codeSentTo: signIn.codeSentTo } : { email });
  }
}

async function submitCode(code: string) {
  const email = signIn.codeSentTo;
  if (!email) return;
  try {
    const signedIn = await accounts?.verifyCode(email, code);
    if (!signedIn) return;
    account = signedIn;
    signIn = {};
    saveAccount(accountFile(), signedIn, safeStorage);
    buildMenu();
    await restoreOrWelcome();
  } catch (err) {
    signInFailed(err, { codeSentTo: email });
  }
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
  buildMenu();
  await restoreOrWelcome();
}

void main();
