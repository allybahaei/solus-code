import { describe, expect, it } from "vitest";
import { insertMention, matchScore, menuTrigger, splitMentions } from "./composer";

describe("menuTrigger", () => {
  it("sees a file being mentioned, at the start or after a space", () => {
    expect(menuTrigger("@ap", 3)).toEqual({ kind: "file", query: "ap", start: 0 });
    expect(menuTrigger("look at @src/ma", 15)).toEqual({ kind: "file", query: "src/ma", start: 8 });
  });

  it("ignores email addresses and finished mentions", () => {
    expect(menuTrigger("me@example.com", 14)).toBeNull();
    expect(menuTrigger("@a.ts then", 10)).toBeNull();
  });

  it("sees a command only at the very start", () => {
    expect(menuTrigger("/pl", 3)).toEqual({ kind: "command", query: "pl" });
    expect(menuTrigger("run /pl", 7)).toBeNull();
    expect(menuTrigger("/plan now", 9)).toBeNull();
  });
});

it("inserts a mention over what was typed, keeping the rest", () => {
  expect(insertMention("see @ap please", 7, 4, "src/app.ts")).toEqual({ text: "see @src/app.ts  please", caret: 16 });
});

it("finds mentions to show as pills", () => {
  expect(splitMentions("fix @src/a.ts and @b.md now")).toEqual([
    { text: "fix ", mention: false },
    { text: "@src/a.ts", mention: true },
    { text: " and ", mention: false },
    { text: "@b.md", mention: true },
    { text: " now", mention: false },
  ]);
  expect(splitMentions("mail me@example.com")).toEqual([{ text: "mail me@example.com", mention: false }]);
});

describe("matchScore", () => {
  it("ranks exact runs above scattered letters, and rejects a miss", () => {
    expect(matchScore("app", "src/app.ts")).toBeLessThan(matchScore("sat", "src/app.ts") ?? 0);
    expect(matchScore("zz", "src/app.ts")).toBeNull();
  });
});
