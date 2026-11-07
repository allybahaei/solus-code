import { expect, it } from "vitest";
import { groupByFolder } from "./format";

it("groups files by folder, root first", () => {
  const groups = groupByFolder([{ path: "src/b.ts" }, { path: "README.md" }, { path: "src/a.ts" }, { path: "src/lib/c.ts" }]);
  expect(groups.map((g) => [g.folder, g.files.map((f) => f.path)])).toEqual([
    ["", ["README.md"]],
    ["src", ["src/a.ts", "src/b.ts"]],
    ["src/lib", ["src/lib/c.ts"]],
  ]);
});
