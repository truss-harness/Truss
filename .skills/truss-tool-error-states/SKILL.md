---
name: truss-tool-error-states
description: Guidance for editing Truss native tool and MCP tool execution, provider tool-call recovery, tool-call streaming, thinking persistence, and error-state UI. Use when changing `src/server/tools/**`, `src/server/http/routes-chat.ts` tool loops, `src/server/llm/chat-completions.ts` tool-call payloads, `src/server/llm/tool-call-recovery.ts` text-encoded provider tool calls, `src/shared/protocol.ts` tool event types, `src/client/api.ts` chat stream handling, `src/client/components/ChatLanding.tsx` assistant stream state, `src/client/components/chat/ChatTranscript.tsx` thinking/tool-call rendering, or related tool error behavior.
---

# Truss Tool Error States

Use this skill before changing native tools, MCP tool execution, or tool-call presentation.

## Error Contract

- Preserve the assistant's thinking state when tools fail. Do not replace accumulated thinking or tool-call rows with a generic provider or stream error.
- Every attempted tool call should emit a visible `tool_call` update with `status: "running"`, then exactly one terminal update with `status: "completed"` or `status: "error"`.
- Long-running MCP tools may emit progress before the terminal update. Preserve progress as `ChatToolCall.progress` on repeated `tool_call` events for the same call ID; do not treat progress as a separate tool result.
- When progress reaches `100`, keep that progress value on the terminal update so the transcript can hold the completed bar briefly before fading it out.
- `spawn_sub_agent` calls should also emit `sub_agent.spawned` and terminal `sub_agent.status` updates. Failed children must leave the parent tool call in `status: "error"` with the child session reference preserved.
- Store failed tool calls in `ChatThinking.toolCalls` with the original arguments, title, timestamps, and full error string so the transcript detail modal can show what happened.
- If all tool calls in a tool turn fail, return an assistant message that summarizes the concrete tool failures and includes the merged thinking/tool metadata. Do not continue into a provider call that only sees `tool_error` messages unless at least one tool call succeeded or there is a deliberate recovery path.
- If a stream-level error still occurs after tool events have arrived, the client should preserve the in-flight assistant message and only mark it `status: "error"`.
- Provider text-call marker syntax such as Kimi, DSML, or MiniMax `<tool_call><invoke name="...">...` blocks should be recovered into internal tool calls and stripped from final assistant content, not written into the transcript as ordinary text.
- Prefer specific user-visible messages such as `Web search: query failed because ...` over vague text like `Error in input stream`.

## Server Rules

- Keep tool definitions and tool execution in `src/server/tools/native-chat-tools.ts` or a focused module under `src/server/tools/`.
- Keep provider tool-call formatting and parsing in `src/server/llm/chat-completions.ts`, `src/server/llm/chat-payloads.ts`, and `src/server/llm/tool-call-recovery.ts`.
- Keep the chat tool loop in `src/server/http/routes-chat.ts`; it should translate provider tool requests into `ChatToolCall` records and stream those records to the client.
- When adding a text-call recovery format, add focused coverage in `tests/server/llm-payloads.test.ts`; if the failure crossed the route loop, also cover `/api/chat` behavior in `tests/server/routes-chat-*.test.ts`.
- Agentic turn-limit exhaustion should return `Agentic turn limit reached (...). Resume or increase the limit in Settings -> AI Behaviour.` and preserve accumulated tool-call thinking.
- Validate tool settings before execution. User-configured URLs, provider IDs, and model IDs must be normalized before they reach the tool runner.
- Tool outputs returned to the model should be compact and structured. Search-like tools should return TOON or another concise structured format, not raw upstream JSON.
- MCP progress should use `_meta.progressToken` on `tools/call` and `notifications/progress` from the server. Normalize progress to a 0-100 percent plus a concise status `message`; keep the final tool response focused on the model-visible output or error.
- Tool failures should be data, not crashes, whenever the failure is local to one tool execution. Add a `role: "tool"` error message for the provider only when the loop can safely continue.

## Truss Web Tools

- `src/server/mcp/servers/truss-web-tools/runtime.ts` owns the Truss Web Tools process runtime. It starts one app-managed Camoufox browser through `src/server/utils/camoufox-browser.ts`; that adapter downloads the pinned Camoufox release into Truss home on first use, drives it through a bundled JavaScript launcher child process, and closes it when the MCP server exits. Do not add a Python Camoufox runtime dependency.
- Keep `web_search`, `load_webpage`, and `get_website_screenshot` browser-backed through the runtime browser. Do not reintroduce direct backend page fetching, undetected-chromedriver, Chromium stealth patches, or a separate bot-control/CAPTCHA classifier path.
- `load_webpage` accepts either one URL or up to five URLs, keeps HTML-to-Markdown conversion, and sanitizes Markdown by default unless `skip-sanitize` is true. JSON responses always skip Markdown conversion and sanitization.
- `load_webpage` should report progress through MCP notifications: `Fetching page...`, `Converting page to text...`, `Sanitizing page...`, then `100%` when the page is sanitized or otherwise ready. Early-return paths such as JSON, raw content, or skipped sanitization should still send a final `100%` update with an accurate status message.
- `get_website_screenshot` should remain capped at a 1024 by 1920 viewport and return compact structured metadata plus base64 image data.
- If Web Tools behavior changes, update `docs/settings.md`, `docs/security.md`, `docs/attributions.md`, and the in-app MCP docs string in `src/server/mcp/servers/truss-chat-tools/server.ts` when those descriptions would otherwise drift.

## Client Rules

- `src/client/components/ChatLanding.tsx` owns the in-flight assistant message while `/api/chat` streams. Preserve its `thinking`, `content`, and `toolCalls` in `catch` paths.
- `src/client/api.ts` should dispatch `tool_call` stream events before generic `error` handling.
- `src/client/components/chat/ChatTranscript.tsx` should render tool calls inside the collapsible thinking panel and keep click-to-detail access for arguments, results, and errors.
- `ChatTranscript.tsx` should render `ChatToolCall.progress` as compact status text plus a small progress bar. A completed `100%` bar should remain visible for about three seconds, then fade out without removing the durable tool-call row.
- Error UI may mark the assistant message as failed, but it should not hide the thinking panel or remove action buttons needed to inspect or retry the turn.

## Validation

1. Run `bun run check`.
2. Run `bun run build` when client or bundled server behavior changes.
3. Run `git diff --check`.
4. Smoke-test a failing tool path with a local mock or intentionally unreachable URL. Confirm the transcript still shows the thinking panel and tool details.
5. For Truss Web Tools changes, run `bun test tests/server/truss-web-tools.test.ts`; use fake browser/runtime fixtures for unit tests instead of launching Camoufox unless the user asks for a live smoke test.
6. Do not use hosted model calls or browser-launching validation unless the user asks or approves.
