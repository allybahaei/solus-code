# Spike: OpenCode (v2.1.1)

Tried in a throwaway repo on a free model.

- `opencode run --format json` is clean: `step_start`, `tool_use`, `text`, `step_finish`, each with `sessionID`. `-s <id>` resumes.
- With no flags, `run` executed `curl` without asking. There is no sandbox and no approval by default.
- `permission: { bash: "deny" }` removes the tool. `bash: "ask"` under `run` rejects the call, because a non-interactive run can't ask. The `bash` key also covers the tool now named `shell`.
- `opencode acp` speaks the Agent Client Protocol over stdio, and is what Solus uses:
  - `initialize`, `session/new { cwd, mcpServers }`, `session/load`, `session/prompt`. A session lasts across turns.
  - `session/request_permission` carries `toolCall { toolCallId, name, title, kind, rawInput.command }` and `options` (`allow_once`, `allow_always`, `reject_once`). It held for 20 seconds, then the command ran.
  - `session/update` carries `agent_message_chunk { messageId, content.text }`, `tool_call`, `tool_call_update` (status `completed` or `failed`), plus thought, usage and command updates that Solus ignores.
- Which provider and bill apply is whatever the user connected to OpenCode, so Solus says that rather than claiming a subscription.

# Cursor

Its docs give `agent acp` over stdio, so it uses the same adapter. The installer creates both `agent` and `cursor-agent` in `~/.local/bin`, which is often not on PATH. Solus shows Cursor only when `status` output looks like Cursor's own.

Later run live through Solus, on `2026.11.05-86047df`:

- `authenticate { methodId: "cursor_login" }` is required before `session/new`, even when signed in.
- Commands ask through `session/request_permission`. Edits inside the worktree don't.
- A refused command never runs (checked with `touch`), but it still ends with `status: "completed"`, so Solus remembers what it refused.
- A model may retry a refused command. Each retry asks again.
- Message chunks have no `messageId`, and titles are Markdown with the command in backticks.
