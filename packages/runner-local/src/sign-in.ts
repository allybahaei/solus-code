import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SetupCommands } from "./setup";
import { cursorCommand } from "./setup";

const exec = promisify(execFile);

/** The only commands Solus will open a terminal for: each tool's own sign-in. */
export function signInCommand(check: string, commands: SetupCommands = {}): string[] | undefined {
  if (check === "claude-code") return [commands.claude ?? "claude", "auth", "login"];
  if (check === "codex") return [commands.codex ?? "codex", "login"];
  if (check === "cursor") return [commands.cursor ?? cursorCommand(), "login"];
  if (check === "gh") return [commands.gh ?? "gh", "auth", "login"];
  return undefined;
}

const quote = (arg: string) => `'${arg.replace(/'/g, `'\\''`)}'`;

/** The script Terminal runs. A login shell, so the user's own PATH applies. */
export function signInScript(argv: readonly string[]): string {
  return [
    "#!/bin/zsh -l",
    "clear",
    argv.map(quote).join(" "),
    'echo ""',
    'echo "Done. You can close this window and go back to Solus."',
    "",
  ].join("\n");
}

/** Opens Terminal running a tool's sign-in. The sign-in itself is between the person and the tool. */
export async function openSignIn(check: string, commands: SetupCommands = {}, platform = process.platform, run: typeof exec = exec): Promise<void> {
  const argv = signInCommand(check, commands);
  if (!argv) throw new Error(`Solus can't sign in to ${check}.`);
  if (platform !== "darwin") throw new Error(`Run \`${argv.join(" ")}\` in a terminal.`);
  const file = join(mkdtempSync(join(tmpdir(), "solus-sign-in-")), "sign-in.command");
  writeFileSync(file, signInScript(argv));
  chmodSync(file, 0o700);
  await run("open", [file]);
}
