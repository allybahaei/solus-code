import { describe, expect, it } from "vitest";
import { mergePath, parseShellPath } from "./shell-path";

describe("parseShellPath", () => {
  it("ignores whatever shell startup files print", () => {
    expect(parseShellPath("welcome!\n__SOLUS_PATH__/a:/b__SOLUS_PATH__\nbye")).toBe("/a:/b");
  });

  it("finds nothing in unrelated output", () => {
    expect(parseShellPath("command not found")).toBeUndefined();
  });
});

describe("mergePath", () => {
  it("puts the shell's PATH first and drops repeats", () => {
    const path = mergePath("/custom:/usr/bin", "/usr/bin:/bin", "/Users/me").split(":");
    expect(path.slice(0, 3)).toEqual(["/custom", "/usr/bin", "/bin"]);
    expect(path.filter((dir) => dir === "/usr/bin")).toHaveLength(1);
  });

  it("still finds usual install folders when the shell gave nothing", () => {
    const path = mergePath(undefined, "/usr/bin", "/Users/me").split(":");
    expect(path).toContain("/opt/homebrew/bin");
    expect(path).toContain("/Users/me/.local/bin");
  });
});
