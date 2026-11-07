import { SOLUS_REPO } from "@solus/core";

/** True when `tag` (such as v0.2.0) is a later release than `current`. */
export function isNewer(current: string, tag: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0]?.split(".").map((n) => Number.parseInt(n, 10) || 0) ?? [];
  const [a, b] = [parse(tag), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export interface Release {
  version: string;
  url: string;
}

/** The latest published release, or null if there's none yet. */
export async function latestRelease(request: typeof fetch = fetch): Promise<Release | null> {
  const res = await request(`https://api.github.com/repos/${SOLUS_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Solus" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const release = (await res.json()) as { tag_name?: string; html_url?: string };
  if (!release.tag_name || !release.html_url) return null;
  return { version: release.tag_name.replace(/^v/, ""), url: release.html_url };
}
