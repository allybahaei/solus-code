import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetCheckpoints, restoreCheckpoint, saveCheckpoint } from "./checkpoint";

let repo: string;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const file = (name: string) => join(repo, name);

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "solus-check-")));
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "t");
  sh("config", "user.email", "t@example.com");
  writeFileSync(file("a.txt"), "one\n");
  writeFileSync(file(".gitignore"), "ignored.txt\n");
  sh("add", "-A");
  sh("commit", "-qm", "init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("checkpoints", () => {
  it("brings back edits, removes files added since, and restores deleted ones", async () => {
    writeFileSync(file("new-before.txt"), "kept\n");
    const commit = await saveCheckpoint(repo, "t1", "m1");

    writeFileSync(file("a.txt"), "changed\n");
    writeFileSync(file("new-after.txt"), "gone\n");
    rmSync(file("new-before.txt"));
    await restoreCheckpoint(repo, commit);

    expect(readFileSync(file("a.txt"), "utf8")).toBe("one\n");
    expect(readFileSync(file("new-before.txt"), "utf8")).toBe("kept\n");
    expect(existsSync(file("new-after.txt"))).toBe(false);
  });

  it("undoes commits made since", async () => {
    const head = sh("rev-parse", "HEAD").trim();
    const commit = await saveCheckpoint(repo, "t1", "m1");
    writeFileSync(file("a.txt"), "committed\n");
    sh("commit", "-qam", "agent commit");
    await restoreCheckpoint(repo, commit);
    expect(sh("rev-parse", "HEAD").trim()).toBe(head);
    expect(readFileSync(file("a.txt"), "utf8")).toBe("one\n");
  });

  it("leaves uncommitted work uncommitted after restoring", async () => {
    writeFileSync(file("a.txt"), "draft\n");
    const commit = await saveCheckpoint(repo, "t1", "m1");
    writeFileSync(file("a.txt"), "later\n");
    await restoreCheckpoint(repo, commit);
    expect(sh("status", "--porcelain").trim()).toBe("M a.txt");
  });

  it("doesn't touch what's staged when saving, or ignored files when restoring", async () => {
    writeFileSync(file("ignored.txt"), "local\n");
    writeFileSync(file("staged.txt"), "s\n");
    sh("add", "staged.txt");
    const commit = await saveCheckpoint(repo, "t1", "m1");
    expect(sh("diff", "--cached", "--name-only").trim()).toBe("staged.txt");
    await restoreCheckpoint(repo, commit);
    expect(readFileSync(file("ignored.txt"), "utf8")).toBe("local\n");
  });

  it("survives garbage collection, until forgotten", async () => {
    const commit = await saveCheckpoint(repo, "t1", "m1");
    expect(sh("for-each-ref", "refs/solus").trim()).toContain(commit);
    await forgetCheckpoints(repo, "t1");
    expect(sh("for-each-ref", "refs/solus").trim()).toBe("");
  });
});
