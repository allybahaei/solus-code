import { basename } from "node:path";
import type { RecentRepo } from "./recents";

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The first screen. Links use solus:// and the main process acts on them. */
export function welcomePage(recents: RecentRepo[]): string {
  const rows = recents
    .map(
      (repo, i) =>
        `<a class="row" href="solus://recent/${i}"><b>${escape(basename(repo.path))}</b><span>${escape(repo.path)}</span></a>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Solus</title><style>
:root { color-scheme: light dark;
  --bg: light-dark(oklch(0.985 0.003 85), oklch(0.2 0.004 75));
  --fg: light-dark(oklch(0.22 0.006 75), oklch(0.93 0.006 85));
  --muted: light-dark(oklch(0.52 0.008 75), oklch(0.68 0.008 80));
  --line: light-dark(oklch(0.91 0.005 85), oklch(1 0.01 85 / 7%)); }
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--fg); font: 14px/1.45 -apple-system, system-ui, sans-serif; -webkit-user-select: none; }
main { width: 400px; max-width: calc(100vw - 32px); }
h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
p { margin: 0 0 20px; color: var(--muted); }
.open { display: block; padding: 9px 14px; border-radius: 8px; text-align: center; text-decoration: none;
  background: var(--fg); color: var(--bg); font-weight: 500; }
h2 { font-size: 12px; font-weight: 500; color: var(--muted); margin: 24px 0 6px; }
.list { max-height: 240px; overflow-y: auto; }
.row { display: block; padding: 7px 8px; border-radius: 6px; color: inherit; text-decoration: none; }
.row:hover { background: var(--line); }
.row b { display: block; font-weight: 500; }
.row span { display: block; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head><body><main>
<h1>Solus</h1><p>Run coding agents in parallel, each in its own worktree.</p>
<a class="open" href="solus://open">Open a repository</a>
${rows ? `<h2>Recent</h2><div class="list">${rows}</div>` : ""}
</main></body></html>`;
}
