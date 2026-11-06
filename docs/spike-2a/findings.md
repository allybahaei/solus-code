# Spike 2a: Claude Code and Codex headless

Tested on 2026-11-06 with Claude Code 2.1.63 and Codex CLI 0.167.0, in a throwaway git repo, on real subscription logins. Recordings are in `fixtures/`, with local paths, hook events and account details removed.

## Result

Both agents can run under Solus on the user's own login. Claude Code works as the plan assumed. Codex works differently and needs its own adapter shape.

| Question | Claude Code | Codex (`codex exec`) |
|---|---|---|
| Structured streaming output | Yes, stream-json with token deltas | Yes, JSONL, but only whole items, no token streaming |
| Several messages in one session | Yes: one process, messages on stdin, one `result` per turn | No: one process per turn |
| Resume after the process ends | Yes: `--resume <id>` keeps the session id | Yes: `codex exec resume <thread_id> <prompt>` |
| We choose the session id | Yes: `--session-id <uuid>` | No: read `thread_id` from `thread.started` |
| End of turn | `result` event | `turn.completed` or `turn.failed` |
| `ask_user` over MCP | Yes, with `--allowedTools mcp__solus__ask_user` | Yes, only with `mcp_servers.solus.default_tools_approval_mode="approve"` |
| Approve a command from the UI | Yes: `--permission-prompt-tool mcp__solus__approve` works, though `--help` doesn't list it | Not in `exec`. `app-server` has it |
| Refused action | Listed in the result's `permission_denials`; the turn still ends as `success` | Looks like an ordinary failed command, for example curl exit 6 with no network |
| Usage info | `total_cost_usd`, `rate_limit_event` | Token counts only |

## Decisions for the adapters

**Claude Code:** one long-lived process per task, as planned. `ask_user` and `approve` both go through a small MCP server in the daemon. Treat `total_cost_usd` as an estimate and never show it as a charge. Show `rate_limit_event` so people can see when their plan's limit resets.

**Codex:** one `codex exec --json` process per turn for the MVP, with stdin closed, resuming by `thread_id`.
- `workspace-write` sandbox, with `ask_user` pre-approved. There is no per-command approval, so the sandbox is the boundary.
- `codex app-server` has what the UI wants: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, plus `turn/steer` and `turn/interrupt`, and `generate-ts` produces typed bindings. It is marked experimental, so it comes after the MVP unless `exec` proves too limiting.

## Traps found

- **`codex exec` hangs if stdin stays open**, even with a prompt argument. It logs "Reading additional input from stdin…". Always close stdin.
- **`codex login status` isn't proof of a working login.** It said "Logged in using ChatGPT" while real runs failed with an expired token. First-run checks need a real test call. An expired login arrives as `turn.failed` with a readable message.
- **Claude Code refuses to start inside another Claude Code session** and warns that nesting can crash active sessions. Solus should show a clear error if `CLAUDECODE` is set. Do not unset it to get past the guard.
- **Refusals don't fail the turn.** Claude reports `success` with `permission_denials`, and Codex just reports a failed command. Neither alone means *stuck*, so the adapter must inspect them.
- **The Codex sandbox has no network by default.** `pnpm install` would fail inside it, so the setup command must run in the daemon, outside the agent.
- **The user's own settings apply.** Claude Code fired the user's session hooks in every run, and Codex loads `~/.codex/config.toml`. Solus doesn't start from a clean environment.

## Not tested yet

These need checking in 2d before relying on them.

- **A long human wait.** `ask_user` answered in 3 seconds here. MCP tool calls may time out when someone takes minutes to reply, on either agent. If they do, raise the timeouts, or end the turn and resume with the answer.
- **Stopping a run** with SIGINT, then resuming, on either agent.
- **Codex in a real worktree.** A worktree's git data lives outside its folder, so `git commit` may fail in the sandbox. Solus can commit for it.
- **The safe-command allowlist** for Claude Code.
- **Whether a subscription or API billing was used** can't be read from these recordings alone. The Claude `five_hour` rate-limit event suggests a subscription. First-run checks should confirm this properly.
