/** Compact age: "now", "4m", "3h", "2d". */
export function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Splits "src/lib/rate-limit.ts" into ["src/lib/", "rate-limit.ts"]. */
export function splitPath(path: string): [dir: string, name: string] {
  const i = path.lastIndexOf("/");
  return i === -1 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
}
