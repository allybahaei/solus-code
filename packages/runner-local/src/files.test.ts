import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceFile, writeWorkspaceFile } from "./files";

let dir: string;
let worktree: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "solus-files-")));
  worktree = join(dir, "work");
  mkdirSync(join(worktree, "src"), { recursive: true });
  mkdirSync(join(worktree, ".git"));
  writeFileSync(join(worktree, ".git/config"), "secret");
  writeFileSync(join(worktree, "src/a.ts"), "hello\n");
  writeFileSync(join(dir, "outside.txt"), "private\n");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("workspace files", () => {
  it("reads and writes inside the worktree", () => {
    expect(readWorkspaceFile(worktree, "src/a.ts")).toBe("hello\n");
    writeWorkspaceFile(worktree, "src/a.ts", "bye\n");
    expect(readFileSync(join(worktree, "src/a.ts"), "utf8")).toBe("bye\n");
  });

  it("refuses paths that climb out", () => {
    expect(() => readWorkspaceFile(worktree, "../outside.txt")).toThrow("outside");
    expect(() => readWorkspaceFile(worktree, join(dir, "outside.txt"))).toThrow("outside");
    expect(() => writeWorkspaceFile(worktree, "../new.txt", "x")).toThrow("outside");
  });

  it("refuses a symlink that leads out", () => {
    symlinkSync(join(dir, "outside.txt"), join(worktree, "link.txt"));
    expect(() => readWorkspaceFile(worktree, "link.txt")).toThrow("outside");
    expect(() => writeWorkspaceFile(worktree, "link.txt", "x")).toThrow("outside");
    expect(readFileSync(join(dir, "outside.txt"), "utf8")).toBe("private\n");
  });

  it("refuses git's own files", () => {
    expect(() => readWorkspaceFile(worktree, ".git/config")).toThrow("outside");
  });

  it("refuses binary files", () => {
    writeFileSync(join(worktree, "img.png"), Buffer.from([1, 0, 2]));
    expect(() => readWorkspaceFile(worktree, "img.png")).toThrow("binary");
  });
});
