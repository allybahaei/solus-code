import { describe, expect, it, vi } from "vitest";
import { isNewer, latestRelease } from "./updates";

describe("isNewer", () => {
  it("compares versions by number, not text", () => {
    expect(isNewer("0.1.0", "v0.2.0")).toBe(true);
    expect(isNewer("0.9.0", "0.10.0")).toBe(true);
    expect(isNewer("0.1.0", "v0.1.0")).toBe(false);
    expect(isNewer("1.0.0", "0.9.9")).toBe(false);
    expect(isNewer("0.1.0", "0.1.1-beta")).toBe(true);
  });
});

describe("latestRelease", () => {
  const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("reads the version and page", async () => {
    await expect(latestRelease(reply(200, { tag_name: "v0.2.0", html_url: "https://example.com/r" }))).resolves.toEqual({ version: "0.2.0", url: "https://example.com/r" });
  });

  it("treats no releases as nothing new", async () => {
    await expect(latestRelease(reply(404))).resolves.toBeNull();
  });

  it("reports other failures", async () => {
    await expect(latestRelease(reply(500))).rejects.toThrow("500");
  });
});
