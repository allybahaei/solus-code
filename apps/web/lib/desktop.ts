import { problemReportUrl } from "@solus/core";

/** What the Mac app offers the page. Absent in a browser. */
interface SolusDesktop {
  version: string;
  /** The real macOS version: the browser's own string is frozen for privacy. */
  platform: string;
  testNotification: () => Promise<boolean>;
  checkForUpdates: () => Promise<void>;
}

export function desktop(): SolusDesktop | undefined {
  return typeof window === "undefined" ? undefined : (window as Window & { solusDesktop?: SolusDesktop }).solusDesktop;
}

/** Opens a new GitHub issue with the version filled in. The person writes the rest. */
export function reportProblem() {
  const app = desktop();
  window.open(problemReportUrl({ version: app?.version ?? "web", platform: app?.platform || "browser" }), "_blank", "noreferrer");
}
