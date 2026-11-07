import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "@solus/core";

/** Shared by every repo, so settings follow the person, not the project. */
export function readSettings(file: string): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS }; // Missing or damaged: the defaults.
  }
}

export function writeSettings(file: string, changes: Partial<Settings>): Settings {
  const settings = { ...readSettings(file), ...changes };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return settings;
}
