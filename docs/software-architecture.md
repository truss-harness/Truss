# Truss Software Architecture

## Purpose

Truss is a single-user localhost agentic harness. It runs a Bun TypeScript backend, serves a React frontend, streams downstream state over Server-Sent Events, and accepts upstream commands and tool resolutions over HTTP POST.

This document defines the module boundaries for modular development. The codebase should grow by adding small modules behind stable contracts, not by expanding one large server or frontend file.

## Current Architecture

```text
index.ts
  -> src/server/index.ts
     -> cli/run.ts
        -> http/server.ts
           -> http/context.ts
           -> http/router.ts
           -> http/routes-*.ts
           -> agent/sample-agent.ts
           -> tools/pending-tool-store.ts
           -> mcp/discovery.ts
           -> mcp/client.ts
           -> mcp/transports/*
           -> llm/registry.ts
           -> skills/discovery.ts
           -> skills/context.ts

public/index.html
  -> public/assets/main.js
     -> src/client/main.tsx
        -> src/client/App.tsx
           -> hooks/useTrussEvents.ts
           -> components/*
```

## Backend Boundaries

### CLI Layer

Files:

- `src/server/cli/parse.ts`
- `src/server/cli/run.ts`
- `src/server/cli/browser.ts`

Responsibilities:

- Parse `truss spawn [workspace path]`.
- Apply process-level defaults such as current working directory and dynamic port selection.
- Resolve an explicit workspace directory, switch the process working directory to it, and scope conversation queries to it. Plain `truss spawn` leaves conversation queries unscoped.
- Start the HTTP server.
- Open the browser when not disabled.

Rules:

- The CLI layer must not implement agent behavior.
- The CLI layer must not parse MCP, LLM, or database configuration directly.
- Add new commands by extending `parseCli` and dispatching from `runCli`.

### HTTP Layer

Files:

- `src/server/http/server.ts`
- `src/server/http/context.ts`
- `src/server/http/router.ts`
- `src/server/http/routes-command.ts`
- `src/server/http/routes-tools.ts`
- `src/server/http/responses.ts`
- `src/server/http/session.ts`

Responsibilities:

- Own `Bun.serve`.
- Construct per-process server context.
- Route `/api/*` requests.
- Serve the static frontend.
- Produce sanitized session metadata.

Rules:

- Route modules should be thin.
- Route modules may validate request shape.
- Route modules should delegate behavior to application modules such as `agent`, `tools`, `mcp`, `llm`, or future `storage`.
- Never expose secrets in `SessionInfo`.

### Event Transport

Files:

- `src/server/event-hub.ts`
- `src/shared/protocol.ts`

Responsibilities:

- Maintain active SSE clients.
- Publish typed event envelopes.
- Replay a small event history on reconnect.

Rules:

- All frontend-visible events must be declared in `src/shared/protocol.ts`.
- SSE event names must remain explicit and versionable.
- Backend modules should publish domain events through `EventHub`, not write SSE manually.

### Agent Layer

Files:

- `src/server/agent/sample-agent.ts`
- `src/server/agent/stream-markdown.ts`

Current responsibility:

- Provide a working starter loop for command echoing, token-like markdown streaming, and sample tool interception.

Target responsibility:

- Own the real agent orchestration loop.
- Select LLM provider adapters.
- Prepare prompt context from MCP capabilities, skills, files, and conversation state.
- Pause and resume around intercepted tool requests.

Rules:

- Keep provider-specific HTTP calls out of the agent loop.
- Keep MCP transport details out of the agent loop.
- The agent should consume interfaces from `llm`, `mcp`, `skills`, and `storage`.

### Tool Interception

Files:

- `src/server/tools/pending-tool-store.ts`
- `src/server/tools/chat-user-choice-store.ts`
- `src/server/tools/sample-tools.ts`
- `src/server/tools/user-choice.ts`
- `src/server/tools/truss-web-tools.ts`
- `src/server/tools/envelope.ts`
- `src/server/tools/approval.ts`
- `src/server/http/routes-chat-user-choices.ts`
- `src/server/mcp/servers/truss-chat-tools/*`
- `src/server/mcp/servers/truss-filesystem-tools/*`
- `src/server/mcp/servers/truss-web-tools/*`
- `src/server/http/routes-chat.ts`
- `src/client/components/ChatLanding.tsx`
- `src/client/components/chat/ChatTranscript.tsx`

Responsibilities:

- Track pending frontend-resolved tool executions.
- Publish `tool.request` events.
- Publish `tool.resolved` events.
- Normalize browser-resolved and MCP tool calls into the same frontend envelope.
- Normalize approval/rejection decisions from browser callbacks.
- Stream MCP chat tool calls as assistant thinking metadata.
- Persist MCP tool-call arguments, TOON results, and errors with assistant messages.
- Recover provider-emitted text tool-call syntax before persistence so marker formats such as Kimi, DSML, and MiniMax do not leak into assistant messages.
- Forward MCP progress notifications into `ChatToolCall.progress` so long-running tools can show status text and a compact progress bar while they run.

Rules:

- Tool request payloads must be JSON serializable.
- Each tool execution must have a stable `executionId`.
- The backend must treat browser payloads as untrusted input and validate them before privileged action.
- Tool errors must preserve the thinking/tool-call record. Do not collapse an attempted tool turn into a generic stream error when concrete tool failures are available.
- Each attempted chat tool call should produce a `ChatToolCall` record with `running`, then `completed` or `error`.
- Tool progress is intermediate state, not a result. MCP servers should emit `notifications/progress` keyed by the request `_meta.progressToken`; `/api/chat` should stream those updates as repeated `tool_call` events for the same `ChatToolCall.id`.
- Preserve the latest progress on the terminal tool-call update so the client can keep `100%` visible briefly before fading it out.
- Provider text-call recovery belongs in `src/server/llm/tool-call-recovery.ts`. The chat route should receive normalized provider tool calls and should not parse provider-specific marker syntax inline.
- If every tool call in a provider-requested tool turn fails, `/api/chat` should complete the assistant turn with a concrete failure summary and merged `ChatThinking.toolCalls`. It should not discard that state or continue into a provider call that is likely to fail on tool-only errors.
- Client catch paths in `ChatLanding.tsx` must preserve the in-flight assistant message's `thinking`, `content`, and streamed tool rows before marking the message as `error`.
- The transcript thinking panel is the durable inspection surface for tool arguments, results, and errors.

## MCP Architecture

Files:

- `src/server/mcp/types.ts`
- `src/server/mcp/config-json.ts`
- `src/server/mcp/registry.ts`
- `src/server/mcp/discovery.ts`
- `src/server/mcp/json-rpc.ts`
- `src/server/mcp/client.ts`
- `src/server/mcp/capability-cache.ts`
- `src/server/mcp/capability-negotiation.ts`
- `src/server/mcp/transports/types.ts`
- `src/server/mcp/transports/stdio.ts`
- `src/server/mcp/transports/http-sse.ts`
- `src/server/mcp/servers/truss-chat-tools/*`
- `src/server/mcp/servers/truss-filesystem-tools/*`
- `src/server/mcp/servers/truss-web-tools/*`
- `src/server/mcp/auth/api-key.ts`
- `src/server/mcp/auth/oauth-client-credentials.ts`
- `src/server/mcp/loaders/claude-config.ts`
- `src/server/mcp/loaders/codex-config.ts`
- `src/server/mcp/loaders/github-copilot-config.ts`
- `src/server/mcp/loaders/junie-config.ts`

Current behavior:

- Ensures a global `~/.truss/mcp.json` config file next to the database and dotenvx secrets.
- Registers bundled first-party stdio servers in the global config when missing:
  `Truss Web Tools` for web search/webpage loading and `Truss Chat Tools`
  for browser-mediated user choice dialogs, local conversation search,
  conversation deletion, `mcp.json` review/edit tools, and chat/MCP
  documentation resources. `Truss Filesystem Tools` is enabled for scoped
  workspace launches and for global launches only when a global directory grant
  exists. The server process enforces access against the workspace root plus
  directory grants for the active workspace or global context while exposing
  metadata, reads, surgical text edits, file refactors, directory creation, and
  directory or individual-file search helpers.
- Reads JSON-shaped MCP config files containing `mcpServers` or `servers`.
- Spawns configured stdio MCP servers and negotiates capabilities.
- Summarizes discovered sources, connected servers, server status, and tool counts in `/api/session`.
- Provides JSON-RPC 2.0 types and message helpers.
- Provides stdio and HTTP/SSE transport factories.
- Provides API key, OAuth2 authorization-code token refresh, and OAuth2 client credentials auth helpers for remote MCP servers.
- Parses MCP tool, resource, and prompt capabilities at startup.
- Executes chat tool calls through MCP `tools/call`.
- Adds a per-call `_meta.progressToken` when the chat route requests progress, accepts MCP `notifications/progress`, and normalizes them into `ChatToolCall.progress` with a clamped percent plus optional short status message.
- Supports MCP `resources/read` on first-party documentation resources exposed by
  Truss Chat Tools.

Supported starter sources:

- Truss global: `~/.truss/mcp.json`

Target behavior:

- Add opt-in working-directory MCP server discovery and approval.
- Connect to HTTP plus SSE MCP servers.
- Present working-directory discovered configs to the user before enabling them.

Adding a new MCP loader:

1. Create `src/server/mcp/loaders/<source>-config.ts`.
2. Implement `McpConfigLoader`.
3. Return only normalized `McpServerDefinition` objects.
4. Register the loader in `src/server/mcp/registry.ts`.
5. Add source documentation to this file.

Loader rules:

- Loaders discover config only.
- Loaders must not start MCP processes.
- Loaders must not perform network calls.
- Loaders should tolerate missing files and malformed JSON.
- Loader output must not include secrets.

MCP tool progress:

- Use the standard MCP progress channel. The host passes `_meta.progressToken` in `tools/call` when a caller wants progress updates.
- A server reports progress with `notifications/progress` and the same `progressToken`. Provide either `progress` as a 0-100 percentage or `progress` plus `total`; Truss normalizes both to a percent.
- Include a concise `message` such as `Fetching page...` or `Sanitizing page...` for user-visible status text.
- Do not put progress-only data in the tool result. The final `tools/call` response should remain the model-visible result.

## LLM Provider Architecture

Files:

- `src/server/llm/types.ts`
- `src/server/llm/registry.ts`
- `src/server/llm/providers/openai.ts`
- `src/server/llm/providers/openrouter.ts`
- `src/server/llm/providers/ollama.ts`
- `src/server/llm/providers/llamacpp.ts`

Current behavior:

- Registers provider descriptors.
- Seeds provider settings in the system SQLite database.
- Resolves provider enablement, base URL overrides, default models, and model lists from SQLite.
- Reads provider secrets from a system dotenvx-backed env file.
- Reports sanitized provider configuration state in `/api/session` and `/api/settings/llm-providers`.
- Does not call provider APIs yet.

Starter providers:

- OpenAI uses `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`.
- OpenRouter uses `OPENROUTER_API_KEY` and optional `OPENROUTER_BASE_URL`.
- Ollama uses optional `OLLAMA_BASE_URL` and does not require an API key by default.
- llama.cpp uses optional `LLAMACPP_BASE_URL` and does not require an API key by default.

Target behavior:

- Provide a common chat/completion streaming interface.
- Normalize token streaming into `agent.delta` events.
- Normalize tool calls into `tool.request` events.
- Support provider-specific model metadata without leaking provider details into the agent loop.

Adding a new LLM provider:

1. Create `src/server/llm/providers/<provider>.ts`.
2. Implement `LlmProvider`.
3. Avoid reading secrets outside the provider descriptor or request adapter.
4. Register the provider in `src/server/llm/registry.ts`.
5. Add provider configuration notes to this file.

Provider rules:

- Provider modules own provider-specific URLs, headers, and response formats.
- Provider modules must expose one Truss-facing interface.
- Provider modules must not publish SSE events directly.
- Provider modules must not read workspace files.
- Provider modules must not expose API key values to the frontend.

Future LLM modules:

- `src/server/llm/chat-provider.ts`
- `src/server/llm/stream-normalizer.ts`
- `src/server/llm/tool-call-normalizer.ts`
- `src/server/llm/model-catalog.ts`

## Frontend Boundaries

### App Shell

Files:

- `src/client/main.tsx`
- `src/client/App.tsx`

Responsibilities:

- Mount React.
- Compose hooks and presentational components.
- Avoid owning transport details directly.

### Transport and API Hooks

Files:

- `src/client/hooks/useTrussEvents.ts`
- `src/client/hooks/useAutoScroll.ts`
- `src/client/api.ts`

Responsibilities:

- Own `EventSource` lifecycle.
- Transform typed backend events into frontend state.
- Own POST calls for commands and tool resolutions.

Rules:

- Components should not call raw `fetch` unless they are transport modules.
- Components should not instantiate `EventSource`.
- Add new backend event handling in `useTrussEvents`.

### Components

Files:

- `src/client/components/AppHeader.tsx`
- `src/client/components/CommandComposer.tsx`
- `src/client/components/MessageBubble.tsx`
- `src/client/components/Panel.tsx`
- `src/client/components/Sidebar.tsx`
- `src/client/components/StatusPill.tsx`
- `src/client/components/Transcript.tsx`
- `src/client/markdown.tsx`
- `src/client/tool-registry.tsx`

Responsibilities:

- Render state.
- Capture local UI input.
- Delegate side effects to props from hooks or API modules.

Rules:

- Tool UI components live behind `tool-registry.tsx`.
- Add one frontend component per high-value MCP tool type.
- Use the generic MCP tool component for `mcp:*` tool IDs until a custom UI is needed.
- Keep the markdown renderer separate from the tool registry so markdown parsing can evolve independently.

## Skills And Context Architecture

Files:

- `src/server/skills/types.ts`
- `src/server/skills/parser.ts`
- `src/server/skills/discovery.ts`
- `src/server/skills/context.ts`
- `src/server/context/prompt-context.ts`

Current behavior:

- Discovers global provider `SKILL.md` files and, in workspace mode, workspace provider skill directories for Codex, Claude, Cursor, GitHub Copilot, Junie, plus generic `.skills` and `skills` directories.
- Parses basic skill name, description, body, and token estimate.
- Selects active skills under a token budget and marks the rest pruned.
- Publishes sanitized skill summaries in `/api/session`.
- Adds skill summaries and filesystem-backed loading instructions to the live system prompt.
- Exposes global and workspace skill directories to Truss Filesystem Tools as read-only roots.

Target behavior:

- Score skills by relevance to the current command, workspace, and MCP capability set.
- Have the model read only relevant `SKILL.md` files and supporting files through filesystem tools.
- Emit `skill.context` events when active/pruned skill state changes.

Rules:

- Skill parsing must tolerate incomplete community skill files.
- Skill bodies must not be sent to the frontend unless the user explicitly requests inspection.
- Context selection must preserve token budget headroom for conversation and tool schemas.

## Runtime And Packaging Architecture

Files:

- `src/server/runtime/command-executor.ts`
- `src/server/runtime/background-runner.ts`
- `src/server/runtime/project-root.ts`
- `packaging/windows/*`

Current behavior:

- Defines a command execution abstraction.
- Defines foreground versus background-service runtime decisions.
- Provides `compile` and `compile:windows` scripts for Bun standalone binaries.
- Resolves source/package roots differently from standalone executable roots so
  installed binaries can serve `public/` from the install directory.
- Provides Windows package scripts for a per-user install, Start Menu launcher,
  tray helper, autostart registration, user PATH registration, and optional
  WinSW-backed service mode.

Target behavior:

- Add policy checks before command execution.
- Add launchd/systemd support for macOS and Linux background runners.

## Styling Pipeline

Files:

- `src/client/tailwind.css`
- `src/client/styles.scss`
- `src/client/styles/_tokens.scss`

Build flow:

```text
styles.scss
  -> styles.generated.css
     -> tailwind.css
        -> public/assets/styles.css
```

Rules:

- Use Tailwind classes for layout and most component styling.
- Use SCSS for shared authored tokens, mixins, and local CSS that is awkward as utilities.
- Do not edit `src/client/styles.generated.css`; it is generated.
- Do not edit `public/assets/*`; it is generated.

## Shared Protocol

File:

- `src/shared/protocol.ts`

Responsibilities:

- Define API request and response contracts.
- Define SSE event envelopes.
- Define sanitized session metadata.

Rules:

- Backend and frontend must import protocol types from this file.
- Changes to event shape must be backward-compatible where possible.
- Do not put provider secrets, raw environment values, or local absolute file contents in protocol payloads.

## Storage Boundary

Files:

- `src/server/storage/database.ts`
- `src/server/storage/migrations.ts`
- `src/server/storage/agent-sessions.ts`
- `src/server/storage/model-profiles.ts`
- `src/server/storage/settings.ts`
- `src/server/storage/filesystem-directory-grants.ts`
- `src/server/config/env.ts`

Responsibilities:

- Own SQLite setup and migrations.
- Persist user configuration.
- Persist LLM provider enablement, base URL overrides, default models, and model lists.
- Persist global fast-helper, conversation, and agentic model profiles.
- Persist conversation, agentic, and sub-agent session metadata with optional working-directory scope.
- Persist Truss Filesystem Tools directory grants by workspace path or global context.
- Read and write encrypted dotenvx-backed provider secrets without exposing values to the frontend.

Schema details and index coverage are documented in `docs/database-schema.md`.

Future storage modules:

- `src/server/storage/conversations.ts`

Rules:

- Storage modules should expose repository-style functions.
- Agent modules should not write SQL directly.
- Route modules should not write SQL directly.

## Development Rules

- Prefer a new module over expanding an unrelated module.
- Keep files small enough that one file has one reason to change.
- Register new extension modules through a registry file.
- Keep side effects at the edge: CLI, HTTP routes, provider adapters, MCP transports, storage.
- Keep shared contracts explicit in `src/shared/protocol.ts`.
- Validate browser-provided payloads before using them for filesystem, process, network, or model actions.
- Do not leak API keys, OAuth tokens, or dotenvx values to frontend session payloads.

## Next Implementation Slices

1. Replace `SampleAgent` with an agent orchestration interface and a real implementation.
2. Add LLM chat streaming adapters for OpenAI, OpenRouter, Ollama, and llama.cpp.
3. Add editing and enablement controls for global MCP servers.
4. Add workspace MCP discovery and approval UI before enabling directory-specific servers.
5. Add skill discovery for `.skills/**/SKILL.md`.
6. Add SQLite persistence for conversation messages and event replay.
7. Add model metadata refresh for configured LLM providers.
