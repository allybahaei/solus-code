import { describe, expect, it } from "vitest";
import { advance, closeOpenMarkup } from "./typewriter";

describe("advance", () => {
  it("keeps a steady pace on a short message", () => {
    expect(advance(0, 50, 1000)).toBe(50);
    expect(advance(0, 500, 100)).toBeCloseTo(25);
    expect(advance(10, 40, 100)).toBeCloseTo(19);
  });

  it("speeds up when far behind", () => {
    expect(advance(0, 4000, 1000)).toBe(2000);
  });

  it("never goes past the text", () => {
    expect(advance(99, 100, 5000)).toBe(100);
    expect(advance(100, 100, 16)).toBe(100);
  });

  it("clears even a long message within seconds", () => {
    let shown = 0;
    let ms = 0;
    while (shown < 6000) {
      shown = advance(shown, 6000, 16);
      ms += 16;
    }
    expect(ms).toBeLessThan(12_000);
  });
});

describe("closeOpenMarkup", () => {
  it("leaves finished markup alone", () => {
    expect(closeOpenMarkup("plain and **bold** and `code`")).toBe("plain and **bold** and `code`");
  });

  it("closes bold and code cut part way", () => {
    expect(closeOpenMarkup("this is **bo")).toBe("this is **bo**");
    expect(closeOpenMarkup("run `pnpm")).toBe("run `pnpm`");
  });

  it("drops half of a bold marker", () => {
    expect(closeOpenMarkup("this is *")).toBe("this is ");
  });
});
