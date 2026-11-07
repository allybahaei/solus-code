import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_RECENTS = 10;

export interface RecentRepo {
  path: string;
  /** Kept per repo, because saved settings in the page belong to its address. */
  port?: number;
  /** Open when the app last quit, so it comes back. */
  open?: boolean;
}

export function readRecents(file: string): RecentRepo[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is RecentRepo => typeof (r as RecentRepo | null)?.path === "string");
  } catch {
    return []; // Missing or damaged: start with an empty list.
  }
}

export function writeRecents(file: string, recents: RecentRepo[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(recents, null, 2));
}

/** Moves a repo to the top, keeping what was already known about it. */
export function remember(recents: RecentRepo[], repo: RecentRepo): RecentRepo[] {
  const known = recents.find((r) => r.path === repo.path);
  return [{ ...known, ...repo }, ...recents.filter((r) => r.path !== repo.path)].slice(0, MAX_RECENTS);
}
