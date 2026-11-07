# Solus

Run several coding agents in parallel on one repo, each in its own worktree, and review and merge from one UI. See `CLAUDE.md` for the product spec.

```bash
pnpm install
pnpm dev        # daemon + web UI on http://localhost:3000, with tasks in the daemon
pnpm dev --repo ../some-repo   # same, on a real repo, running your own Claude Code, Codex or OpenCode
pnpm dev --repo ../some-repo --fake   # a fake agent that edits files, with no model
pnpm dev:web    # web UI only, with a mock inside the page, for UI work
pnpm lint && pnpm typecheck && pnpm test
```

- `apps/web`: Next.js UI
- `packages/core`: Task, TaskState, Runner and event types
- `packages/runner-mock`: scripted fake runner used by the prototype
- `packages/runner-local`: the real Runner: git worktrees, real diffs, saved state in `~/.solus`
- `packages/daemon`: local server exposing a Runner over WebSocket (127.0.0.1, token required)
- `packages/cli`: the `solus-code` command, which bundles all of this with the built UI
- `packages/desktop`: the Mac app, which runs the same daemon and UI in Electron, with a window per repo
- `packages/runner-client`: the browser's `RemoteRunner`, which talks to the daemon

## Using it

Solus runs your own Claude Code, Codex, OpenCode and Cursor, on your own logins, so usage counts against your plans (with OpenCode, whichever provider you connected). Install and sign in to at least one of them, then run this inside a git repo:

```bash
npx solus-code
```

It opens your browser. Anything missing shows on the Home screen with the command that fixes it. Solus keeps its state and worktrees in `~/.solus`.

Not on npm yet. To build the package from this repo:

```bash
pnpm package
```

To build the Mac app and its `.dmg`, which aren't signed yet, into `packages/desktop/release`:

```bash
pnpm --filter @solus/desktop dist
```

Builds need no account unless `SOLUS_SUPABASE_URL` and `SOLUS_SUPABASE_PUBLISHABLE_KEY` are set, and then the app asks for an email sign-in once. The project's Magic Link email template must include `{{ .Token }}`, so it sends a code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repo settings

An optional `solus.json` at the root of the repo being worked on prepares each new worktree:

```json
{
  "setup": "pnpm install",
  "copy": [".env.local"],
  "run": { "dev": "pnpm dev --port $SOLUS_PORT", "test": "pnpm test" }
}
```

`run` adds commands to the Run tab, as one string or several named ones. Each task gets a block of ten ports starting at `$SOLUS_PORT`, so the same app can run from several tasks at once. Agents and terminals get it too, along with `$SOLUS_WORKSPACE_PATH` and `$SOLUS_ROOT_PATH`.

## Licence

[Apache 2.0](LICENSE). The Solus name and logo aren't covered by the licence. See [NOTICE](NOTICE).
