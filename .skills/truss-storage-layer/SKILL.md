---
name: truss-storage-layer
description: Guidance for working on Truss database, configuration, provider settings, model profiles, agent sessions, migrations, and secret handling. Use when editing `src/server/storage/**`, `src/server/config/**`, storage-backed HTTP settings routes, SQLite migrations, `docs/database-schema.md`, or any feature that persists provider configuration, model defaults, conversation/agentic/sub-agent session metadata, or dotenvx-backed secrets.
---

# Truss Storage Layer

Use this skill before changing Truss persistence, configuration, or settings APIs.

## Core Rules

- Keep secrets out of SQLite. Provider API keys belong in the dotenvx-backed `~/.truss/.env`; private key material belongs in `~/.truss/.env.keys`.
- Access SQLite through repository modules in `src/server/storage/**`. Do not write SQL directly in agents, route handlers, or UI code.
- Put schema changes in `src/server/storage/migrations.ts` as a new numbered migration. Do not edit already-applied migration SQL unless the existing migration is known to be unreleased and disposable.
- Keep protocol payloads sanitized. Never return API keys, OAuth tokens, dotenvx values, or raw process env values to the frontend.
- Keep provider/model identity explicit as `providerId` plus `modelId`; do not serialize provider/model as one ambiguous string.
- Snapshot provider/model/generation parameters into `agent_sessions` when a session is created. Later profile changes should not silently rewrite historical session metadata.
- Enforce sub-agent hierarchy through storage constraints: only `sub-agent` sessions have `parentSessionId`, and they must have one.
- Keep agentic tool turn limit settings on the `rich_feature_settings` singleton: `agentic_tool_turn_limit_enabled` and `agentic_tool_turn_limit`, defaulting to enabled and 300.

## Workflow

1. Read `docs/database-schema.md` before changing tables, indexes, or repository query patterns.
2. Search repository methods for the affected tables before deciding on columns or indexes.
3. Add or update migration SQL, then update the matching repository module.
4. Update `src/shared/protocol.ts` only with sanitized fields needed by browser/API clients.
5. Update HTTP route validation before accepting new browser-provided fields.
6. Update `docs/database-schema.md` when schema, constraints, indexes, or query patterns change.
7. Validate with `bun run check`; for schema/index work, also create a temporary SQLite DB and inspect `PRAGMA index_list(...)`.

## Current Storage Boundaries

- `settings.ts`: LLM provider settings, excluding secrets.
- `model-profiles.ts`: global `fast-helper`, `conversation`, and `agentic` model defaults.
- `agent-sessions.ts`: persisted conversation, agentic, and sub-agent session metadata.
- `chat-messages.ts`: persisted user/assistant transcript rows, attachments, and exposed thinking metadata for conversation history.
- `setup.ts`: first-run setup completion and optional prompt personalization.
- `env.ts`: dotenvx secret env boundary.
- `migrations.ts`: authoritative schema and index changes.

## Reference

Load `references/storage-contract.md` when you need the schema summary, index policy, route map, or validation checklist in context.
