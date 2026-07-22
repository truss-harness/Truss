---
name: truss-chat-interface
description: Guidance for working on the Truss chat landing interface, transcript markdown rendering, composer, model selector, file attachment UI, conversation/agent mode toggle, `/api/chat` route, and LLM provider chat completion routing. Use when editing `src/client/components/ChatLanding.tsx`, `src/client/components/chat/ChatTranscript.tsx`, `src/client/markdown.tsx`, `FileDropTextarea.tsx`, `ModelSelector.tsx`, `MaterialIcon.tsx`, `src/client/api.ts` chat helpers, `src/shared/protocol.ts` chat payloads, `src/server/http/routes-chat.ts`, `src/server/llm/chat-completions.ts`, or related chat UI/backend behavior.
---

# Truss Chat Interface

Use this skill before changing the chat experience or the minimal chat backend in Truss.

## Current Shape

- `src/client/components/ChatLanding.tsx` owns the chat screen state, loaded transcript, generated conversation title display, session mutations, composer submit flow, and `/api/chat` streaming orchestration.
- `src/client/components/chat/` owns extracted chat UI pieces and helpers: `ConversationSidebar.tsx` for past conversations, context menus, stats tooltip, and manual rename; `ChatPromptCard.tsx` for composer controls and mode toggle; `ChatTranscript.tsx` for bubbles, message actions, thinking display, attachment previews, and message-edit attachment controls; `AttachmentPreviewModal.tsx` for transcript and composer attachment inspection, image crop, and image redaction; `ConversationHeader.tsx` for the title/model selector top bar; `MobileNavigation.tsx` for the mobile nav; `useModelSelectorState.ts` for model option loading; and `chat-utils.ts`/`types.ts` for reusable pure helpers and UI types.
- `FileDropTextarea.tsx` owns textarea resize, Enter-to-send, Shift+Enter newline behavior, drag/drop attachment staging, attachment chips, disabled attachment staging state, and conversion from browser `File` objects to `ChatAttachment` payloads.
- `ModelSelector.tsx` owns the searchable model dropdown. It defaults to the current conversation or agentic profile, labels providers in both closed and open states, and is rendered in `ConversationHeader` above the transcript/composer.
- `MaterialIcon.tsx` is the shared Material Symbols wrapper.
- `src/client/markdown.tsx` parses rendered chat markdown and delegates rich renderers to `src/client/components/markdown/`.
- `src/client/api.ts` exposes `streamChatMessage(...)`, a compatibility `sendChatMessage(...)`, `fetchAgentSessions()`, `fetchAgentSession(...)`, session action helpers, and model/session fetch helpers.
- `src/shared/protocol.ts` defines `ChatRequest`, `ChatResponse`, `ChatStreamEvent`, `ChatMessage`, `StoredChatMessage`, `ChatAttachment`, `ChatThinking`, `AgentSessionSummary` stats, `AgentSessionDetailResponse`, and `AgentSessionTitleEvent`.
- `src/server/http/routes-chat.ts` validates chat payloads, creates or reuses `agent_sessions`, syncs the request transcript before the provider call, appends the completed assistant reply, and routes to the selected `providerId` plus `modelId`.
- `src/server/storage/chat-messages.ts` owns persisted chat transcript reads/writes and computed message/word stats for the sidebar. Do not query `chat_messages` directly from routes.
- `src/server/internal-ai/truss-internal-ai-services.ts` generates internal helper-model metadata such as conversation titles through the `fast-helper` profile.
- `src/server/llm/chat-completions.ts` calls OpenAI-compatible `/chat/completions` providers and Ollama `/api/chat`, forwards supported attachments, streams answer/thinking chunks, and returns optional exposed reasoning as `ChatThinking`.

## Frontend Rules

- Keep the composer visually separated from the model selector. Before the first message, the selector sits with the title above the centered composer. Once chat begins, the title and selector move to the top bar and the composer docks at the bottom as a compact fixed-position input bar; the transcript is the scroll region. The docked bar's subtle white bordered surface should wrap the attach button, textarea, mode toggle, and send button together.
- Preserve `Enter` to send and `Shift+Enter` for a newline in `FileDropTextarea`.
- Drag-and-drop attachments are real chat inputs. Images display inline and are forwarded as image inputs where the provider supports them; text/markdown/RTF are forwarded as text; converted documents include source metadata for model context.
- Transcript attachments and staged image chips should open `AttachmentPreviewModal` instead of direct-download anchors. Text attachments show stored text or data-URL text, and images show a large inspectable preview with Download, Crop, and Redact actions. Staged image chips also show an inline image expansion on hover/focus, using the same expansion pattern as convertible document controls. Crop uses `react-easy-crop` with visible crop handle bars. Saving a crop or redaction updates the owning attachment state: persisted transcript images PATCH the message attachments, edit-form images update the draft attachment list, and staged composer images replace the pending browser `File`.
- User-message editing should preserve current attachments unless removed, stage added files through `FileDropTextarea` and `createChatAttachments(...)`, then PATCH the combined attachment list through `/api/agent-sessions/:sessionId/messages/:messageId`. If messages follow the edited item, prompt for overwrite regeneration, duplicate-session regeneration, or no regeneration.
- Show a spinner while the assistant is pending. When the provider streams exposed reasoning, render it immediately in a clickable thinking panel before the final answer completes; keep the final panel collapsed with duration and word count.
- Render `ChatToolCall.progress` inside the thinking panel as short status text plus a compact progress bar. Keep the row inspectable as a normal tool call, and let `100%` progress stay visible for about three seconds before fading away.
- Keep the left sidebar backed by `/api/agent-sessions` and load transcript details through `/api/agent-sessions/:id`. Opening a session should restore type, title, model selection, and persisted messages without making a model call.
- Keep model IDs out of the visible sidebar row. The collapsed row should stay one line: title, compact borderless conversation/agent badge, date, and a hover/focus actions trigger. Show model and message/word stats only in the hover tooltip while collapsed, and suppress that tooltip while the sidebar search box is focused.
- When sidebar search is focused or contains text, expand the sidebar and show per-session message and word counts inline as row columns; do not show aggregate message/word totals below the search input. While search has focus, dim and blur the main chat area to the right.
- The sidebar conversation context menu should support Duplicate, Copy to Clipboard, Export as HTML/Markdown, Rename by auto-title/manual title, and Delete. Keep exported/copied content client-side from `/api/agent-sessions/:id`; keep persistent mutations backed by explicit session routes.
- Use the sliding badge in `ModeToggle` for mode animation. Do not replace it with simple fade or per-button background swaps.
- Once a session has messages, the `ConversationHeader` mode toggle stays interactive. Its state is a per-turn `modeOverride` only; it does not mutate the stored session type and should explain that scope in the tooltip.
- Keep conversation and agent active colors distinct.
- Prefer small reusable components over adding logic directly to `ChatLanding.tsx`.
- Render `spawn_sub_agent` tool calls as `SubAgentChip` rows in the thinking panel. Clicking a chip opens `SubAgentPanel`, a local right-side read-only drawer backed by the child session transcript.
- Pass fetched rich feature settings into `MarkdownView` from the active chat surface. Use `markdownContainsWideContent(...)` when assistant-rendered tables, maps, or diagrams need full transcript width.

## Backend Rules

- Route chat through `/api/chat`; do not reuse `/api/commands` or the sample agent path for real chat.
- `/api/chat` returns `application/x-ndjson` streaming events: `start`, `content_delta`, `thinking_delta`, `done`, and `error`. Do not reintroduce a blocking JSON-only response for the main chat UI.
- `/api/chat` may stream repeated `tool_call` events for the same `ChatToolCall.id` while a tool runs. Merge these updates client-side so progress/status changes do not clobber existing thinking, arguments, results, or errors.
- Use explicit `providerId` and `modelId`; never combine them into one ambiguous value.
- Create an `agent_sessions` row on first send. If an existing `sessionId` is reused with a different selected provider or model, create a new session.
- Store transcript rows through `ChatMessagesRepository`: sync the full request transcript before the provider call so active in-memory conversations can be backfilled, then append the assistant reply after successful completion. Preserve attachments and exposed thinking metadata when appending existing persisted replies.
- Keep session mutations under `/api/agent-sessions`: duplicate sessions through repository helpers, rename titles with `AgentSessionsRepository.updateAgentSessionTitle(...)`, update message content and attachments through `ChatMessagesRepository.updateSessionMessage(...)`, and delete sessions through the session repository so SQLite cascades remove messages.
- Use `$truss-internal-ai-services` when adding or changing generated conversation titles or other helper-model metadata. Titles are generated asynchronously and pushed with `agent.session.title`; `/api/chat` must not wait on title generation.
- Use `defaultProfileIdForAgentSessionType(...)` to resolve conversation vs agentic defaults.
- `/api/chat` accepts `modeOverride` for the current turn only. Conversation mode should run one tool-use batch plus a final answer pass; agentic mode should keep looping until terminal response, configured cap, or the consecutive-failure guard.
- Agentic turns may include the reserved internal `spawn_sub_agent` tool. It is not a third-party MCP tool, creates a `sub-agent` child row, streams child progress to the parent chat stream, and returns the child final answer as the parent tool result.
- MCP progress is reported with `_meta.progressToken` and `notifications/progress`, then surfaced as `ChatToolCall.progress`. Keep progress out of final model-visible tool results.
- Read provider credentials only through `context.secretEnv.mergedWithProcessEnv()`. Never expose secret values to the browser.
- For provider calls, keep OpenAI-compatible and Ollama request formats separate in `chat-completions.ts`.
- Keep rich-feature prompt hints in `renderSystemPromptForChat(...)` so `/api/chat` appends them at send time without changing stored prompt templates or transcripts.
- If changes touch persistence schema or repository behavior, also use `$truss-storage-layer`.

## Validation

1. Run `bun run check`.
2. Run `bun run build:client` after frontend changes.
3. Start or restart the local server when backend routes change.
4. Validate `/api/chat` with a bad payload or invalid provider first to confirm routing without making a real model call.
5. Use Playwright screenshots for layout changes.
6. Only send a real model request when the user asks or approves, because hosted providers may incur cost.
