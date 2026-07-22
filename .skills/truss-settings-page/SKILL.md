---
name: truss-settings-page
description: Guidance for working on the standalone Truss settings page, settings client APIs, provider connection management, customization fields, editable system prompt templates, rich feature settings, and system storage-path disclosure. Use when editing `src/client/components/SettingsScreen.tsx`, `/settings` routing in `src/client/App.tsx`, `src/client/api.ts` settings helpers, `src/server/http/routes-settings.ts`, `src/server/prompts/system-prompts.ts`, related settings storage, or `docs/settings.md`.
---

# Truss Settings Page

Use this skill before changing the settings experience or its supporting APIs.

## Core Rules

- Keep `/settings` separate from the chat workspace layout. A small navigation link from chat is fine; the settings screen itself should render through `SettingsScreen`.
- Organize the settings screen as tabs, not one long scrolling page.
- In Connections, keep provider identity/status visible, but hide endpoint/default-model/secret fields until the provider is enabled. Explain what each provider is and what its Base URL means.
- Do not add a manual provider models textarea on the settings page; providers should use their `/models` endpoint for model choices.
- Keep provider secrets write-only. UI inputs may rotate or remove secrets, but route responses must only expose configured/encrypted/source status.
- Store provider API keys through `SecretEnvStore`, not SQLite.
- Store prompt templates in `system_prompt_settings`; render them server-side before model calls.
- Stack conversation and agentic prompt editors vertically. Include template syntax help and a Restore default action.
- Store thinking/tool replay preferences in `conversation_history_settings`; keep prompt-only history augmentation out of stored transcript content.
- Show the agentic tool turn limit in the AI Behaviour tab alongside reasoning-budget controls. The values are stored in `rich_feature_settings` as `agentic_tool_turn_limit_enabled` and `agentic_tool_turn_limit`, defaulting to enabled and 300.
- Store rich renderer preferences in `rich_feature_settings`; keep the base system prompt template editable separately from rich-feature prompt appendices.
- Keep customization fields on the existing `first_run_setup` singleton: `nickname`, `location`, and `preferredLanguage`.
- Show local storage paths through `/api/settings/system`; do not guess paths in the browser. Explain what the database, Truss home, encrypted env file, and dotenvx key file are for.

## File Map

- `src/client/components/SettingsScreen.tsx`: standalone settings UI.
- `src/client/App.tsx`: route switch for `/settings`.
- `src/client/api.ts`: browser fetch helpers for setup, providers, history, rich features, system prompts, and system settings.
- `src/server/http/routes-settings.ts`: settings route validation and sanitized responses.
- `src/server/prompts/system-prompts.ts`: default templates and Mustache-style renderer.
- `src/server/storage/history-settings.ts`: thinking/tool history preference repository.
- `src/server/storage/rich-feature-settings.ts`: smart table/event, PlantUML, and KaTeX preference repository.
- `src/server/storage/system-prompts.ts`: prompt-template repository.
- `src/server/storage/migrations.ts`: schema changes.
- `docs/settings.md`: user-facing settings docs.
- `docs/database-schema.md`: schema docs for settings tables.

## Prompt Templates

- Support `{{datetime}}`, `{{location}}`, `{{nickname}}`, `{{preferred_response_language}}`, `{{preferredLanguage}}`, and `{{preferred response language}}`.
- Wrap optional personalization lines in sections such as `{{#nickname}}...{{/nickname}}` so blank values are skipped.
- Keep the server renderer and any client preview behavior aligned when adding template syntax.

## History Settings

- Keep thinking history default-off. When enabled, `/api/chat` may append stored provider-exposed thinking to the provider prompt payload only.
- Do not write augmented thinking blocks back to `chat_messages.content`.
- Keep tool history replay visibly marked unavailable until tool calls/results are persisted in session history.

## Rich Feature Settings

- Keep rich features in their own tab. Always explain what each feature is useful for, but show detailed controls only while that feature is enabled.
- Smart tables default off. Disabled tables should still render as regular styled HTML tables; enabled tables can add prompt hints and interactive controls.
- Smart Events default off. Disabled event syntax should render as plain text with no modal; enabled events can expose Google, Outlook, and ICS actions only when their sub-settings are enabled.
- PlantUML defaults to disabled, official server URL, and SVG rendering. Append custom PlantUML prompt instructions only while PlantUML is enabled and the custom instructions are non-empty.
- KaTeX defaults to disabled. When enabled, markdown rendering can interpret inline `$...$` and display `$$...$$` math.

## Validation

1. Run `bun run check`.
2. Run `bun run build:client` after frontend changes.
3. For route changes, use non-launching startup commands from `AGENTS.md` and validate `/api/settings/system`, `/api/settings/system-prompts`, `/api/settings/rich-features`, and `/settings`.
4. Do not make real hosted provider calls unless the user asks or approves.
