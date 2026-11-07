import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRecents, remember, writeRecents } from "./recents";

const dirs: string[] = [];
function file() {
  const dir = mkdtempSync(join(tmpdir(), "solus-recents-"));
  dirs.push(dir);
  return join(dir, "nested/recents.json");
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("recents", () => {
  it("saves and reads back", () => {
    const path = file();
    writeRecents(path, [{ path: "/repo", port: 4400, open: true }]);
    expect(readRecents(path)).toEqual([{ path: "/repo", port: 4400, open: true }]);
  });

  it("starts empty when the file is missing or damaged", () => {
    const path = join(mkdtempSync(join(tmpdir(), "solus-recents-")), "recents.json");
    dirs.push(join(path, ".."));
    expect(readRecents(path)).toEqual([]);
    writeFileSync(path, "{nope");
    expect(readRecents(path)).toEqual([]);
  });

  it("moves a repo to the top and keeps its port", () => {
    const recents = remember([{ path: "/a" }, { path: "/b", port: 4400 }], { path: "/b", open: true });
    expect(recents).toEqual([{ path: "/b", port: 4400, open: true }, { path: "/a" }]);
  });

  it("keeps the list short", () => {
    let recents: { path: string }[] = [];
    for (let i = 0; i < 15; i++) recents = remember(recents, { path: `/${i}` });
    expect(recents).toHaveLength(10);
    expect(recents[0]?.path).toBe("/14");
  });
});
