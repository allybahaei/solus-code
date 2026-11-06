# CLAUDE.md

App name: **Solus**.

## What we're building

A web app for running several coding agents (Claude Code and Codex in the MVP) in parallel on one repo. Each task gets its own isolated workspace (git worktree + branch), and the user supervises, reviews and merges from one calm, fast UI.

**Bring your own subscription.** Solus never calls a model itself. It runs the official `claude` and `codex` tools on the user's machine, on the login they already have, so usage counts against their own plan or API key. Solus has no model billing and no account in the middle. Never read, copy or proxy their login tokens. Warn when an environment variable such as `ANTHROPIC_API_KEY` would switch someone from their subscription to API billing. Check each provider's terms before running a subscription login on a remote sandbox.

The bar for UX is Conductor (conductor.build), which is winding down. We match the *feel* of its core loop, not its look. We do not copy its visual design, copy, or branding.

Long-term differentiator: cloud-first. Agents can run in cloud sandboxes, so the app works from any OS and from a phone. The local runner comes first; the cloud runner later implements the same interface.

## The core loop

```
Create task → Isolated workspace spins up → Agent works → User reviews diff → Merge / open PR
```

Everything in the UI serves this loop. If a feature doesn't make one of these steps faster or clearer, it doesn't ship yet.

## Task states

Every task is always in exactly one state. The state must be visible at a glance everywhere the task appears.

| State | Meaning | User action expected |
|---|---|---|
| `idle` | Created, agent not started | Start it |
| `working` | Agent is running | None — watch if curious |
| `needs_input` | Agent asked a question or needs approval | Answer / approve |
| `stuck` | Agent errored, looped, or stalled past a timeout | Inspect, nudge or restart |
| `ready_for_review` | Agent finished, diff is ready | Review |
| `merged` | Changes merged or PR opened | None (archived) |

Allowed transitions:

- `idle → working`
- `working → needs_input | stuck | ready_for_review`
- `needs_input → working`
- `stuck → working` (restart / nudge)
- `ready_for_review → working` (request changes) | `merged`

`needs_input` and `stuck` are attention states: they sort to the top and get the strongest visual signal. `working` should feel alive but quiet.

## Layout

One three-pane app shell. There is no separate board screen: the sidebar is the board.

```
┌──────────────┬────────────────────────────────┬───────────────────┐
│ Workspaces   │ [tab][tab][tab]  +             │ Changes  12       │
│              │ Title · branch · state  action │  file  +12 −3     │
│ Needs you    │                                │  file  +40        │
│ ● task       │  chat transcript               │                   │
│ ● task       │  (agent output, tool calls,    ├───────────────────┤
│ Active       │   user messages)               │ Terminal          │
│ ◌ task       │                                │  $ pnpm test      │
│ ○ task       │  ┌──────────────────────────┐  │  ✓ 612 passed     │
│ ▸ Merged     │  │ reply / request changes  │  │                   │
└──────────────┴──┴──────────────────────────┴──┴───────────────────┘
```

1. **Sidebar: workspaces** — every task for the repo, attention states first ("Needs you"), then active, then merged (collapsed). Each row: state, title, last activity; attention rows show a tint. New task is one keystroke away.
2. **Center: chat** — tabs across the top for open workspaces. Below them a header (title, branch, state, the next action), the agent conversation with tool calls collapsed, and a composer to reply, nudge or request changes.
3. **Right: changes and terminal** — files changed (+/−) on top, the workspace's terminal below.
4. **Review** — the diff for one task, opened from the changes list: file list + side-by-side or unified diff, inline comments, "Request changes" (sends comments back to the agent → `working`) and "Merge" / "Open PR".
5. **Merge / PR** — confirm target branch, commit message / PR title and body (pre-filled from the task), then do it. A modal off the header or Review.

On narrow screens the sidebar becomes the first screen, and a task shows Chat / Changes / Terminal as tabs.

## Design principles

- **Status at a glance.** A user returning after 20 minutes should know what needs them within one second.
- **Keyboard-first.** Every core action has a shortcut. Command palette (`⌘K` / `Ctrl+K`). Suggested defaults: `N` new task, `J/K` move, `Enter` open, `R` review, `M` merge, `Esc` back.
- **Minimal chrome.** No decorative panels. Content (agent output, diffs) gets the space.
- **Calm by default, loud only for attention states.** Use colour sparingly; reserve the strongest accent for `needs_input` and `stuck`.
- **Fast.** Optimistic UI, no spinners for local actions, stream agent output as it arrives.
- **Dark and light themes** from day one, via CSS variables / Tailwind tokens.
- Responsive enough that the task board and review screens work on a phone (needed for the cloud/mobile story later).

## Stack

- **Next.js** (App Router) + **TypeScript** (strict)
- **Tailwind CSS** with design tokens defined as CSS variables
- **shadcn/ui** (Radix) for primitives; customise, don't ship defaults as-is
- Diff rendering: a library like `react-diff-view` or `@git-diff-view/react`
- Terminal rendering: `xterm.js`
- State: React Server Components where natural; client state with Zustand
- Runner ↔ UI transport: WebSocket (or SSE) for streaming agent output and state changes
- Package manager: pnpm, monorepo via pnpm workspaces

## Repo structure

```
apps/
  web/              # Next.js UI
packages/
  core/             # shared types: Task, TaskState, Runner interface, events
  runner-local/     # local daemon: worktrees + spawning agents
  runner-mock/      # fake runner that emits scripted events (used by the prototype)
  daemon/           # local server: exposes a Runner over WebSocket, the app's backend
  runner-client/    # RemoteRunner: the browser's Runner, connected to the daemon
```

## The Runner interface

The UI only ever talks to a `Runner`. Implementations: `runner-mock` (now), `runner-local` (next), `runner-cloud` (later). Sketch:

```ts
interface Runner {
  createTask(input: { repo: string; title: string; prompt: string; baseBranch: string }): Promise<Task>;
  startTask(id: string): Promise<void>;
  sendMessage(id: string, message: string): Promise<void>;
  stopTask(id: string): Promise<void>;
  getDiff(id: string): Promise<Diff>;
  merge(id: string, opts: MergeOptions): Promise<void>;
  openPullRequest(id: string, opts: PROptions): Promise<{ url: string }>;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}
```

`RunnerEvent` covers: state changes, agent output chunks, terminal output chunks, diff updated, errors. Keep this interface stable; it is the seam that makes the cloud version possible without UI changes.

## Build order

1. **Prototype with mock data** — `packages/core` types, `runner-mock` with scripted tasks moving through every state, then the four screens. No real git, no real agents.
2. **Local runner** — create worktree + branch per task, spawn the user's Claude Code or Codex in it through a per-agent adapter, stream output, detect `needs_input` / `stuck` / done. Only agents that are installed and logged in appear in the picker.
3. **Real review and merge** — real diffs from the worktree, inline comments sent back to the agent, merge locally or open a PR via `gh`.
4. **Cloud runner** — same interface, sandboxed remote workspaces.

Do not start a step until the previous one feels good to use.

## Working conventions for Claude Code

- Build **one screen or one package per session**. Don't scaffold everything at once.
- Before building a screen, propose its layout and states in a short plan; build after agreement.
- Every screen must handle: empty state, loading, each task state, and errors.
- Commit after each screen or feature that works and feels right, with a clear message.
- Run `pnpm lint` and `pnpm typecheck` before considering anything done.
- Prefer small, readable components over clever abstractions.
- No placeholder lorem ipsum in the mock data — use realistic task titles, file names and agent messages so the UX can be judged honestly.

## First prompt to paste into Claude Code

> Read CLAUDE.md. Set up the pnpm monorepo with `apps/web` (Next.js App Router, TypeScript strict, Tailwind, shadcn/ui) and `packages/core` with the Task, TaskState and Runner types. Then build `packages/runner-mock` with about 6 realistic tasks that move through every state over time. Don't build any screens yet. Show me the plan first, then build it and commit.

## Second prompt

> Read CLAUDE.md. Propose a layout for the Task board: describe it in a few lines, then show 2–3 layout options as a quick ASCII sketch each, with how each handles the attention states, keyboard navigation and a narrow (phone) screen. Recommend one. Wait for my pick, then build it against `runner-mock` and commit.
