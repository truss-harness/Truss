# Truss Protocol Contract

## Transport Model

Truss uses two browser/backend channels:

- Downstream: `GET /api/events` with Server-Sent Events.
- Upstream: `POST` requests for commands, tool resolution, and future MCP approvals.

The browser never opens raw MCP transports directly. MCP stdio, HTTP, and SSE connections are owned by the backend.

## SSE Event Families

All events are defined in `src/shared/protocol.ts`.

Core events:

- `system.ready`: initial sanitized session snapshot.
- `agent.state`: coarse state changes such as idle, thinking, streaming, or waiting for tools.
- `agent.message`: complete user/system/assistant message.
- `agent.delta`: token-like assistant markdown stream.
- `agent.done`: assistant stream completion.

Tool events:

- `tool.request`: browser-resolved tool request.
- `tool.resolved`: browser callback payload has been accepted by the backend.

MCP events:

- `mcp.capabilities`: discovered server tools, prompts, and resources.
- `mcp.execution.result`: backend result for an approved or rejected MCP tool execution.

Sub-agent events:

- `sub_agent.spawned`: `{ subSessionId, parentSessionId, task }` plus runtime metadata when an agentic parent creates a child session.
- `sub_agent.status`: `{ subSessionId, status }`, where status is `running`, `done`, or `error`.

Skill events:

- `skill.context`: active and pruned skills for the current prompt context.

## Tool Envelopes

Browser-resolved tools and MCP tools share `tool.request`.

Browser-resolved tool example:

```json
{
  "type": "tool.request",
  "origin": "native",
  "executionId": "exec_...",
  "toolId": "clarify_next_step",
  "title": "Clarify the next harness action",
  "args": {}
}
```

MCP tool example:

```json
{
  "type": "tool.request",
  "origin": "mcp",
  "executionId": "exec_...",
  "toolId": "mcp:filesystem:read_file",
  "mcp": {
    "serverId": "filesystem",
    "toolName": "read_file"
  },
  "approval": {
    "policy": "on_demand",
    "reason": "MCP tool execution requires explicit approval."
  },
  "args": {
    "path": "README.md"
  }
}
```

## Upstream Requests

Command submission:

```http
POST /api/commands
Content-Type: application/json

{ "content": "inspect this project" }
```

Tool resolution:

```http
POST /api/tools/:executionId/resolve
Content-Type: application/json

{ "payload": { "choice": "Continue" } }
```

MCP approval resolution uses the same endpoint today and should carry:

```json
{
  "payload": {
    "approved": true,
    "payload": {
      "args": {}
    }
  }
}
```

Future implementations may add a dedicated approval route if the agent loop needs separate validation semantics.

## Session Metadata

`/api/session` and `system.ready` include sanitized summaries:

- `workspacePath` and `conversationScope`: active working directory plus whether
  conversation APIs are showing all conversations or only one workspace. Plain
  `truss spawn` uses all conversations; `truss spawn [workspace path]` scopes
  conversations to that directory.
- `mcp`: global config path, source loader result, connected server counts, sanitized server status, and discovered tools/resources/prompts.
- `llmProviders`: provider IDs, labels, local/hosted/custom kind, enabled state, resolved base URLs, model settings, configured flags, whether credentials are required, env var names, and per-secret status metadata.
- `modelProfiles`: the fast-helper, conversation, and agentic default provider/model/parameter profiles.
- `skills`: discovered/active skill counts and summaries.

Session metadata must never include API key values, OAuth tokens, full skill bodies, or unredacted secret-bearing config values.

## Provider Settings

`GET /api/settings/llm-providers` returns the same sanitized provider summaries used in session metadata.

`PATCH /api/settings/llm-providers/:providerId` accepts provider enablement, base URL, default model, model list, and provider-owned secret env vars. Secret values are written to the system dotenvx env file and are never returned by the API.

`GET /api/settings/model-profiles` returns global default model profiles for fast helper work, conversation sessions, and agentic sessions.

`PATCH /api/settings/model-profiles/:profileId` accepts provider ID, model ID, and common generation parameters: `temperature`, `topP`, `topK`, and `contextSize`.

`GET /api/settings` returns the aggregate settings envelope used for cross-cutting settings. It currently includes `richFeatures`.

`POST /api/settings` accepts `{ "richFeatures": { ... } }` and uses the same validation as `PATCH /api/settings/rich-features`.

## Chat Turns

`POST /api/chat` streams newline-delimited JSON events. The body includes the current transcript messages, optional session/model/provider IDs, tool settings, the session creation `type`, and optional per-turn mode override:

```json
{
  "sessionId": "session_...",
  "type": "conversation",
  "modeOverride": "agentic",
  "messages": []
}
```

`modeOverride` may be `conversation` or `agentic`. It affects only the current turn's system prompt and loop behavior; it does not update the stored `agent_sessions.type`.

Agentic mode may expose the internal `spawn_sub_agent` tool to the model. This tool is not an MCP server tool. It accepts `task` and optional `tools`, creates a `sub-agent` session linked by `parent_session_id`, runs the child agentic loop with the same tool-turn limit, and returns the child final answer as the parent tool result.

Chat stream events include `start`, `content_delta`, `thinking_delta`, `tool_call`, `user_choice_request`, `done`, and `error`. Agentic turns can also emit `sub_agent.spawned`, `sub_agent.status`, `sub_agent.delta`, `sub_agent.thinking_delta`, `sub_agent.tool_call`, and `sub_agent.message` so the UI can render a live child transcript panel.

`tool_call` events carry a `ChatToolCall`. During execution, the same `ChatToolCall.id` may be streamed more than once. Intermediate updates can include `progress: { percent, message? }`; the terminal update sets `status` to `completed` or `error` and preserves the latest progress value when one was reported.

## MCP Tool Progress

Truss uses the MCP progress notification pattern for long-running MCP tools. When the chat route wants progress, it calls `tools/call` with a request metadata token:

```json
{
  "name": "load_webpage",
  "arguments": {
    "url": "https://example.com/"
  },
  "_meta": {
    "progressToken": "mcp_progress_..."
  }
}
```

The MCP server can then send JSON-RPC notifications before the final response:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "mcp_progress_...",
    "progress": 60,
    "total": 100,
    "message": "Sanitizing page..."
  }
}
```

Use concise status messages because they are rendered directly in the transcript. `progress` may already be a percentage or may be paired with `total`; Truss normalizes either form to a clamped 0-100 percent. Progress is UI state only: keep the final `tools/call` result as the model-visible result or error. The transcript keeps a completed `100%` bar visible for three seconds, then fades it away.

## MCP Settings

`GET /api/settings/mcp` returns the global MCP config path, current `mcp.json` text, bundled MCP tool preferences, and non-secret status for configured `TRUSS_MCP_*` credentials.

`PATCH /api/settings/mcp` accepts `mcpConfigText`, `mcpSecrets`, `restoreTrussMcpDefault`, `sanitizerProviderId`, and `sanitizerModelId`.

- `mcpConfigText` must be valid JSON. Saving it writes the global appdata `mcp.json` file and refreshes Truss-managed first-party server defaults, including the current working directory and, when scoped, the `--workspace-path` value used by Truss Chat Tools and Truss Filesystem Tools.
- `mcpSecrets` writes or removes `TRUSS_MCP_*` values in the dotenvx encrypted Truss secret file and never returns secret values.
- `restoreTrussMcpDefault: true` replaces Truss-managed first-party server entries with their current default definitions.

## Agent Sessions

Agent-session routes operate on the active conversation scope. Scoped launches
filter by `agent_sessions.workspace_path`; unscoped launches can access all
conversations, including workspace-scoped ones.

`GET /api/agent-sessions` returns persisted session metadata plus computed `messageCount` and `wordCount` values for each visible session.

`GET /api/agent-sessions/:id` returns one persisted session with computed counts plus its chronological user/assistant transcript messages.

`POST /api/agent-sessions` creates a persisted `conversation`, `agentic`, or `sub-agent` session. Sub-agent sessions must include `parentSessionId`; non-sub-agent sessions must not. Each created session stores the selected provider ID, model ID, and generation parameters.
