import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listOpenTargets, openFolder } from "./open";

describe("listOpenTargets", () => {
  it("offers nothing off macOS", () => {
    expect(listOpenTargets("linux")).toEqual([]);
  });

  it("always offers Finder, and finds apps in the user's own folder", () => {
    const home = mkdtempSync(join(tmpdir(), "solus-open-"));
    mkdirSync(join(home, "Applications/Zed.app"), { recursive: true });
    const targets = listOpenTargets("darwin", home);
    expect(targets.at(-1)?.id).toBe("finder");
    expect(targets.map((t) => t.id)).toContain("zed");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("openFolder", () => {
  const run = () => vi.fn(async () => ({ stdout: "", stderr: "" })) as unknown as Parameters<typeof openFolder>[2] & ReturnType<typeof vi.fn>;

  it("opens a folder in Finder or a named app", async () => {
    const exec = run();
    await openFolder("finder", "/w", exec);
    await openFolder("vscode", "/w", exec);
    expect(exec).toHaveBeenNthCalledWith(1, "open", ["/w"]);
    expect(exec).toHaveBeenNthCalledWith(2, "open", ["-a", "Visual Studio Code", "/w"]);
  });

  it("refuses anything it doesn't know", async () => {
    const exec = run();
    await expect(openFolder("-a Calculator", "/w", exec)).rejects.toThrow("can't open");
    expect(exec).not.toHaveBeenCalled();
  });
});
