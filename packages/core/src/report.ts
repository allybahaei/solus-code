/** Where Solus is developed, for reports and releases. */
export const SOLUS_REPO = "allybahaei/solus-code";

/**
 * A new GitHub issue, started for the person. Only the version and platform go
 * in it: they describe the problem themselves, and see everything before sending.
 */
export function problemReportUrl({ version, platform }: { version: string; platform: string }): string {
  const body = ["**What happened?**", "", "", "**What did you expect?**", "", "", "---", `Solus ${version || "unknown"} · ${platform}`].join("\n");
  return `https://github.com/${SOLUS_REPO}/issues/new?${new URLSearchParams({ body })}`;
}
