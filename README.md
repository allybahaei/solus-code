# Solus

Run several coding agents in parallel on one repo, each in its own worktree, and review and merge from one UI. See `CLAUDE.md` for the product spec.

```bash
pnpm install
pnpm dev        # daemon + web UI on http://localhost:3000, with tasks in the daemon
pnpm dev --repo ../some-repo   # same, on a real repo, running your own Claude Code or Codex
pnpm dev --repo ../some-repo --fake   # a fake agent that edits files, with no model
pnpm dev:web    # web UI only, with a mock inside the page, for UI work
pnpm lint && pnpm typecheck && pnpm test
```

- `apps/web`: Next.js UI
- `packages/core`: Task, TaskState, Runner and event types
- `packages/runner-mock`: scripted fake runner used by the prototype
- `packages/runner-local`: the real Runner: git worktrees, real diffs, saved state in `~/.solus`
- `packages/daemon`: local server exposing a Runner over WebSocket (127.0.0.1, token required)
- `packages/runner-client`: the browser's `RemoteRunner`, which talks to the daemon

## Repo settings

An optional `solus.json` at the root of the repo being worked on prepares each new worktree:

```json
{ "setup": "pnpm install", "copy": [".env.local"] }
```
