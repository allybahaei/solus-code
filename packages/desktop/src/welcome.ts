import { basename } from "node:path";
import type { RecentRepo } from "./recents";

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const HEAD = `<!doctype html><html><head><meta charset="utf-8"><title>Solus</title><style>
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
label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
input { width: 100%; padding: 9px 11px; margin-bottom: 12px; border-radius: 8px; border: 1px solid var(--line);
  background: transparent; color: inherit; font: inherit; outline: none; -webkit-user-select: text; }
input:focus { border-color: var(--muted); }
button.open { width: 100%; border: 0; font: inherit; font-weight: 500; cursor: default; }
button.open:disabled { opacity: 0.6; }
.error { color: light-dark(oklch(0.5 0.17 27), oklch(0.72 0.15 27)); margin: 0 0 12px; }
.links { display: flex; justify-content: space-between; margin-top: 14px; font-size: 12px; }
.links a { color: var(--muted); }
</style></head><body><main>
`;

/** The first screen. Links use solus:// and the main process acts on them. */
export function welcomePage(recents: RecentRepo[]): string {
  const rows = recents
    .map(
      (repo, i) =>
        `<a class="row" href="solus://recent/${i}"><b>${escape(basename(repo.path))}</b><span>${escape(repo.path)}</span></a>`,
    )
    .join("");
  return `${HEAD}<h1>Solus</h1><p>Run coding agents in parallel, each in its own worktree.</p>
<a class="open" href="solus://open">Open a repository</a>
${rows ? `<h2>Recent</h2><div class="list">${rows}</div>` : ""}
</main></body></html>`;
}

export interface SignInStep {
  /** Set once a code has been sent. */
  codeSentTo?: string;
  email?: string;
  error?: string;
}

const BUSY = `onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent=b.dataset.busy"`;

/** Email, then the code from it. Forms submit to solus:// for the main process. */
export function signInPage({ codeSentTo, email, error }: SignInStep): string {
  const problem = error ? `<p class="error" role="alert">${escape(error)}</p>` : "";
  if (codeSentTo) {
    return `${HEAD}<h1>Check your email</h1><p>We sent a code to ${escape(codeSentTo)}.</p>
<form action="solus://code" ${BUSY}>
<label for="code">Code</label>
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" autofocus required>
${problem}<button class="open" data-busy="Checking…">Continue</button></form>
<div class="links"><a href="solus://change-email">Use a different email</a><a href="solus://resend">Send a new code</a></div>
</main></body></html>`;
  }
  return `${HEAD}<h1>Welcome to Solus</h1><p>Enter your email to sign in or create your account.</p>
<form action="solus://email" ${BUSY}>
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" value="${escape(email ?? "")}" autofocus required>
${problem}<button class="open" data-busy="Sending…">Email me a code</button></form>
</main></body></html>`;
}
