---
name: truss-internal-ai-services
description: Guidance for server-only Truss helper-model features, including conversation title generation, lightweight summaries, internal classification, and other non-user-facing AI tasks. Use when editing `src/server/internal-ai/**`, adding calls to the `fast-helper` model profile, returning generated chat metadata through `/api/chat`, or persisting internal AI outputs such as agent-session titles.
---

# Truss Internal AI Services

Use this skill before adding or changing AI calls that support Truss itself rather than directly answering the user.

## Current Shape

- `src/server/internal-ai/truss-internal-ai-services.ts` owns server-only helper-model features.
- Conversation title generation uses the `fast-helper` model profile from `llm_model_profiles`.
- `routes-chat.ts` schedules the internal service in the background when a valid chat starts and the session has no title.
- Generated titles are persisted through `AgentSessionsRepository.updateAgentSessionTitle(...)`.
- Generated titles are pushed to the browser with `agent.session.title` SSE events. `/api/chat` must not synchronously wait for title generation.
- `/api/chat` returns the already-persisted title, if one exists, as `ChatResponse.title`.
- The client displays the title in `ConversationHeader`, where the model selector also lives.

## Rules

- Keep internal AI calls server-only. Never expose provider credentials, raw dotenvx values, or process env values to the browser.
- Resolve provider/model through the configured `fast-helper` profile unless the user explicitly asks for another internal profile.
- Keep provider identity explicit as `providerId` plus `modelId`; do not encode them into one string.
- Use `generateChatCompletion(...)` for provider calls. Keep provider-specific request formats in `src/server/llm/chat-completions.ts`.
- Internal niceties must not break core chat. If title generation or another helper task fails, let the user-facing chat response continue unless the user asked for strict failure.
- Sanitize model output before persisting or returning it. Strip prefixes like `Title:`, quotes, extra lines, markdown, and overlong text.
- Publish generated metadata through typed events in `src/shared/protocol.ts` and `context.hub.publish(...)` when the browser needs live updates.
- Use repository methods for persistence. Do not write SQL directly in HTTP routes or internal AI service modules.
- If schema or storage behavior changes, also use `$truss-storage-layer`.

## Validation

1. Run `bun run check`.
2. Run `bun run build:client` when protocol or chat UI changes touch the browser bundle.
3. Validate `/api/chat` with a bad payload or invalid provider first to confirm route behavior without making a real model request.
4. Use Playwright screenshots for title/header layout changes.
5. Only make a real hosted-provider helper call when the user asks or approves, because it can incur cost.
