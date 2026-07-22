# Project Initiative Breakdown

This breakdown translates the product initiative into implementation slices. Status labels describe the current repository state.

Status meanings:

- Prepared: module contracts or starter implementation exist.
- Partial: working vertical slice exists but production behavior is incomplete.
- Planned: documented only.

## Frontend Development

| Initiative | Status | Prepared Files |
| --- | --- | --- |
| Minimal React project optimized for LLM code generation | Prepared | `src/client/main.tsx`, `src/client/App.tsx`, `src/client/components/*` |
| Markdown parser with interactive UI embedding path | Partial | `src/client/markdown.tsx`, `src/client/components/markdown/*`, `src/client/tool-registry.tsx`, `docs/truss-flavored-markdown.md`, `docs/security.md` |
| Rich markdown renderers for Cards, Timelines, follow-up prompts, callouts, tables, events, maps, PlantUML, and KaTeX | Partial | `src/client/markdown.tsx`, `src/client/components/markdown/*`, `src/client/styles.scss`, `src/server/storage/rich-feature-settings.ts`, `docs/attributions.md` |
| SSE consumer for text, state, and tool UI events | Prepared | `src/client/hooks/useTrussEvents.ts`, `src/shared/protocol.ts` |
| Tailwind layout for nested agents and skill context | Partial | `src/client/components/Sidebar.tsx`, `src/client/styles.scss`, `src/client/tailwind.css` |
| Conversation and agentic chat workspace UI | Partial | `src/client/components/ChatLanding.tsx`, `src/client/components/chat/ConversationHeader.tsx`, `src/client/components/chat/ChatPromptCard.tsx`, `src/client/components/chat/ChatTranscript.tsx`, `src/client/components/chat/ConversationSidebar.tsx` |
| Standalone settings screen | Partial | `src/client/components/SettingsScreen.tsx`, `src/client/App.tsx`, `src/server/storage/rich-feature-settings.ts`, `docs/settings.md`, `.skills/truss-settings-page/SKILL.md` |
| Dynamic React component registry for MCP tools | Partial | `src/client/tool-registry.tsx`, `src/client/components/chat/ToolSettingsModal.tsx`, `src/client/components/chat/ChatTranscript.tsx`, `.skills/truss-tool-error-states/SKILL.md` |

Next frontend work:

1. Add explicit nested sub-agent state components.
2. Add a `SKILL.md` documentation viewer that renders selected skill summaries and optionally full bodies.
3. Add editing controls for global MCP server definitions after backend capability negotiation is live.
4. Add renderer smoke tests for rich markdown features after a browser test harness is introduced.
5. Add custom MCP tool components for high-value tools after backend capability negotiation is live.

## Backend Development: MCP Host And Server Logic

| Initiative | Status | Prepared Files |
| --- | --- | --- |
| Bun workspace with native TypeScript | Prepared | `package.json`, `tsconfig.json`, `src/server/index.ts` |
| CLI parser for directory path injection | Prepared | `src/server/cli/parse.ts`, `src/server/cli/run.ts` |
| Load local skill configurations | Prepared | `src/server/skills/discovery.ts`, `src/server/skills/parser.ts` |
| HTTP server for static assets and fetch requests | Prepared | `src/server/http/*`, `src/server/static.ts` |
| Settings APIs for providers, history, prompts, rich features, and system paths | Partial | `src/server/http/routes-settings.ts`, `src/server/storage/settings.ts`, `src/server/storage/history-settings.ts`, `src/server/storage/rich-feature-settings.ts`, `src/server/storage/system-prompts.ts` |
| MCP JSON-RPC 2.0 routing layer | Partial | `src/server/mcp/json-rpc.ts`, `src/server/mcp/client.ts`, `src/server/mcp/runtime.ts` |
| stdio MCP transport | Partial | `src/server/mcp/transports/stdio.ts`, `src/server/mcp/servers/truss-chat-tools/*`, `src/server/mcp/servers/truss-filesystem-tools/*`, `src/server/mcp/servers/truss-web-tools/*` |
| HTTP/SSE MCP transport | Prepared | `src/server/mcp/transports/http-sse.ts` |
| Tool interception envelopes | Prepared | `src/server/tools/envelope.ts`, `src/server/tools/pending-tool-store.ts` |
| Truss Web Tools MCP server for chat | Partial | `src/server/tools/truss-web-tools.ts`, `src/server/mcp/servers/truss-web-tools/*`, `src/server/http/routes-chat.ts`, `src/server/storage/chat-messages.ts`, `.skills/truss-tool-error-states/SKILL.md` |
| Truss Chat Tools MCP server for local Truss data | Partial | `src/server/mcp/servers/truss-chat-tools/*`, `src/server/storage/agent-sessions.ts`, `src/server/storage/chat-messages.ts`, `src/server/mcp/global-config.ts` |
| Truss Filesystem Tools MCP server for workspace files and scoped directory grants | Partial | `src/server/mcp/servers/truss-filesystem-tools/*`, `src/server/mcp/global-config.ts`, `src/server/storage/filesystem-directory-grants.ts`, `docs/security.md`, `docs/database-schema.md` |

Next backend work:

1. Add working-directory MCP discovery and approval on top of the global config path.
2. Persist enabled/disabled MCP server state instead of relying only on JSON edits.
3. Add approval policy checks for high-risk MCP tool calls.
4. Add validation policies for command execution and MCP tool arguments.

## Skills And Context Management

| Initiative | Status | Prepared Files |
| --- | --- | --- |
| Skill auto-loading from `SKILL.md` | Prepared | `src/server/skills/discovery.ts`, `src/server/skills/parser.ts` |
| Capability negotiation for MCP tools/resources/prompts | Prepared | `src/server/mcp/capability-negotiation.ts`, `src/server/mcp/capability-cache.ts` |
| Context window optimization | Prepared | `src/server/skills/context.ts`, `src/server/context/prompt-context.ts` |

Next skills/context work:

1. Add relevance scoring so only command-relevant skills become active.
2. Add prompt assembly that combines active skills, MCP schemas, conversation history, and workspace facts.
3. Emit `skill.context` events whenever the active context changes.

## Integration And Communication

| Initiative | Status | Prepared Files |
| --- | --- | --- |
| SSE stream for real-time output and UI components | Prepared | `src/server/event-hub.ts`, `src/client/hooks/useTrussEvents.ts` |
| HTTP POST command and tool callbacks | Prepared | `src/server/http/routes-command.ts`, `src/server/http/routes-tools.ts`, `src/client/api.ts` |
| Standard event payload structure | Prepared | `src/shared/protocol.ts`, `docs/protocol-contract.md` |
| MCP approval/rejection callback shape | Prepared | `src/server/tools/approval.ts`, `src/client/tool-registry.tsx` |

Next integration work:

1. Add dedicated approval route if MCP approvals need stricter validation than generic tool resolution.
2. Add event persistence to SQLite so reconnect history survives process restarts.
3. Add frontend state for `agent.state`, `mcp.capabilities`, and `skill.context` beyond session summaries.

## Packaging And Distribution

| Initiative | Status | Prepared Files |
| --- | --- | --- |
| NPM global CLI package configuration | Prepared | `package.json`, `index.ts` |
| Bun compile scripts | Prepared | `package.json` scripts `compile`, `compile:windows` |
| Background runner support | Prepared | `src/server/runtime/background-runner.ts` |
| Directory scoping smoke path | Prepared | `package.json` script `spawn:scoped`, `src/server/cli/parse.ts` |
| Windows per-user install, tray, Start Menu, PATH, and autostart package | Partial | `packaging/windows/*`, `src/server/runtime/project-root.ts` |

Next packaging work:

1. Finalize npm registry name and publish strategy.
2. Add signed Windows installer/release automation.
3. Add smoke tests for workspace-specific `.skills`, `.mcp.json`, and provider env detection.
