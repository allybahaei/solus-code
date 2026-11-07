# Spike: Codex app-server (v0.167.0)

Tried on a throwaway repo, then live through the Mac app. `fixtures/codex-app-server.jsonl` is a recorded run, kept to turn and item notifications.

- `codex app-server` speaks JSON-RPC over stdio, one JSON object a line, without the `jsonrpc` field. It's marked experimental.
- Order: `initialize`, then the `initialized` notification, then `thread/start` or `thread/resume`, then `turn/start`.
- `item/agentMessage/delta` streams replies. 60 deltas for a three-sentence answer, the first after 2.4 seconds. `exec --json` only gives whole items.
- The session stays open across turns, so one process serves a whole conversation.
- `thread/resume` keeps the conversation after a new process. A lost thread fails with "no rollout found".
- `developerInstructions` keeps Solus's instructions out of the user's prompt.
- With `workspace-write` and `on-request`, the sandbox stays on, with no network. Commands outside it arrive as `item/commandExecution/requestApproval`, and `decline` stops them. A refused write left no file.
- A blocked command doesn't always ask. `curl ... | head -1` exited 0 with no output, so Codex saw no failure.
- Codex can send requests Solus doesn't support, including `account/chatgptAuthTokens/refresh`. Solus answers these with an error so nothing waits, and never handles login tokens.
- Notifications carry plan and rate limit details, so fixtures shouldn't record `account/*`.
