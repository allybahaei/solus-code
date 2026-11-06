# Solus

Run several coding agents in parallel on one repo, each in its own worktree, and review and merge from one UI. See `CLAUDE.md` for the product spec.

```bash
pnpm install
pnpm dev        # daemon + web UI on http://localhost:3000, with tasks in the daemon
pnpm dev:web    # web UI only, with a mock inside the page, for UI work
pnpm lint && pnpm typecheck && pnpm test
```

- `apps/web`: Next.js UI
- `packages/core`: Task, TaskState, Runner and event types
- `packages/runner-mock`: scripted fake runner used by the prototype
- `packages/daemon`: local server exposing a Runner over WebSocket (127.0.0.1, token required)
- `packages/runner-client`: the browser's `RemoteRunner`, which talks to the daemon
