# Solus

Run several coding agents in parallel on one repo, each in its own worktree, and review and merge from one UI. See `CLAUDE.md` for the product spec.

```bash
pnpm install
pnpm dev        # web UI on http://localhost:3000, backed by runner-mock
pnpm lint && pnpm typecheck && pnpm test
```

- `apps/web`: Next.js UI
- `packages/core`: Task, TaskState, Runner and event types
- `packages/runner-mock`: scripted fake runner used by the prototype
