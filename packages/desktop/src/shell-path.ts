import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MARK = "__SOLUS_PATH__";
const TIMEOUT_MS = 5_000;

/** Between marks, because shell startup files can print anything. */
export function parseShellPath(output: string): string | undefined {
  return output.split(MARK)[1] || undefined;
}

/** The shell's PATH first, then places agents usually install, without repeats. */
export function mergePath(fromShell: string | undefined, current: string, home: string): string {
  const usual = ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".local/bin"), join(home, ".opencode/bin")];
  const dirs = [...(fromShell ?? "").split(":"), ...current.split(":"), ...usual];
  return [...new Set(dirs.filter(Boolean))].join(":");
}

/** Apps opened from Finder get a bare PATH, so ask the user's own shell. */
export async function loginShellPath(shell: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec(shell, ["-ilc", `printf '%s%s%s' ${MARK} "$PATH" ${MARK}`], { timeout: TIMEOUT_MS });
    return parseShellPath(stdout);
  } catch {
    return undefined; // A broken shell config shouldn't stop the app.
  }
}
