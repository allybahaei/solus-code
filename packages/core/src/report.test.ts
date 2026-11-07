import { expect, it } from "vitest";
import { problemReportUrl } from "./report";

it("starts an issue with only the version and platform filled in", () => {
  const url = new URL(problemReportUrl({ version: "0.1.0", platform: "macOS 26.4 arm64" }));
  expect(url.origin + url.pathname).toBe("https://github.com/allybahaei/solus-code/issues/new");
  expect(url.search.startsWith("?body=") && !url.search.includes("&")).toBe(true);
  expect(url.searchParams.get("body")).toContain("Solus 0.1.0 · macOS 26.4 arm64");
});
