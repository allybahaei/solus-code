import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { OpenTarget } from "@solus/core";

const exec = promisify(execFile);

const APPS: readonly (OpenTarget & { app: string })[] = [
  { id: "vscode", label: "VS Code", kind: "editor", app: "Visual Studio Code" },
  { id: "cursor", label: "Cursor", kind: "editor", app: "Cursor" },
  { id: "zed", label: "Zed", kind: "editor", app: "Zed" },
  { id: "windsurf", label: "Windsurf", kind: "editor", app: "Windsurf" },
  { id: "sublime", label: "Sublime Text", kind: "editor", app: "Sublime Text" },
  { id: "webstorm", label: "WebStorm", kind: "editor", app: "WebStorm" },
  { id: "xcode", label: "Xcode", kind: "editor", app: "Xcode" },
  { id: "terminal", label: "Terminal", kind: "terminal", app: "Terminal" },
  { id: "iterm", label: "iTerm", kind: "terminal", app: "iTerm" },
  { id: "ghostty", label: "Ghostty", kind: "terminal", app: "Ghostty" },
  { id: "warp", label: "Warp", kind: "terminal", app: "Warp" },
];

const FINDER: OpenTarget = { id: "finder", label: "Finder", kind: "finder" };

function installed(app: string, home: string): boolean {
  const places = ["/Applications", "/System/Applications/Utilities", "/System/Applications", join(home, "Applications")];
  return places.some((dir) => existsSync(join(dir, `${app}.app`)));
}

/** Apps on this Mac that can open a folder. Nothing elsewhere yet. */
export function listOpenTargets(platform = process.platform, home = homedir()): OpenTarget[] {
  if (platform !== "darwin") return [];
  return [...APPS.filter((a) => installed(a.app, home)).map(({ id, label, kind }) => ({ id, label, kind })), FINDER];
}

/** The target comes from the page, so only known ids ever reach the command. */
export async function openFolder(target: string, path: string, run: typeof exec = exec): Promise<void> {
  if (target === FINDER.id) {
    await run("open", [path]);
    return;
  }
  const app = APPS.find((a) => a.id === target);
  if (!app) throw new Error(`Solus can't open ${target}.`);
  await run("open", ["-a", app.app, path]);
}
