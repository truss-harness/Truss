# Truss Storage Contract

Use this reference for Truss persistence and configuration work.

## Source Files

- `src/server/storage/database.ts`: opens SQLite, enables `PRAGMA foreign_keys = ON`, sets WAL mode, runs migrations.
- `src/server/storage/migrations.ts`: schema and index migrations.
- `src/server/storage/settings.ts`: `llm_provider_settings` repository.
- `src/server/storage/history-settings.ts`: `conversation_history_settings` repository.
- `src/server/storage/model-profiles.ts`: `llm_model_profiles` repository.
- `src/server/storage/agent-sessions.ts`: `agent_sessions` repository.
- `src/server/storage/chat-messages.ts`: persisted chat transcript repository.
- `src/server/storage/setup.ts`: `first_run_setup` repository.
- `src/server/config/env.ts`: dotenvx-backed secret storage.
- `docs/database-schema.md`: human-readable schema and index documentation.

## Tables

### `llm_provider_settings`

Non-secret provider configuration.

- Primary key: `provider_id`
- Stores: `enabled`, `base_url`, `default_model`, `models_json`, timestamps.
- Does not store API keys.
- Secrets for provider credentials are represented in protocol only as configured/encrypted/source metadata.

### `llm_model_profiles`

Global defaults for model roles.

- Primary key: `profile_id`
- Valid IDs: `fast-helper`, `conversation`, `agentic`
- Stores: `provider_id`, `model_id`, `temperature`, `top_p`, `top_k`, `context_size`, labels/descriptions, timestamps.
- `provider_id` references `llm_provider_settings(provider_id)`.

### `agent_sessions`

Session metadata for conversations, agentic sessions, and sub-agents.

- Primary key: `id`
- Valid types: `conversation`, `agentic`, `sub-agent`
- `parent_session_id` references `agent_sessions(id)` and is required only for `sub-agent`.
- Stores provider/model/parameter snapshots at creation time.

### `chat_messages`

Persisted transcript messages for sessions.

- Primary key: `id`
- `session_id` references `agent_sessions(id)`.
- Stores user/assistant content, sanitized attachment JSON, optional exposed thinking metadata, and timestamps.
- Provides computed message and word counts for session-list UI; these are derived from rows and not stored in `agent_sessions`.
- Do not store provider secrets or raw environment values in attachments or message metadata.

### `first_run_setup`

Singleton first-run setup and optional prompt personalization.

- Primary key: `id = 1`
- Stores: `completed`, `nickname`, `preferred_language`, `location`, `model_catalog_url`, timestamps.
- Does not store secrets.
- Nickname, preferred language, and location are optional prompt customization context, not account identity.

### `conversation_history_settings`

Singleton prompt replay preferences.

- Primary key: `id = 1`
- Stores: `include_thinking_history`, `include_tool_history`, timestamps.
- Thinking history is available because `chat_messages` stores provider-exposed thinking metadata.
- Tool history replay should only become active once chat tool calls/results are persisted as session history.

## Index Policy

Primary-key lookups are covered by SQLite primary-key indexes or rowid primary keys.

Add secondary indexes for:

- Child-side foreign keys, especially if parent deletes/updates can occur.
- Active query filters.
- Active query ordering where row count can grow.
- Composite filter/order patterns such as `(type, created_at DESC)`.

Avoid indexes for:

- Tiny fixed tables unless a foreign key needs support.
- Low-cardinality booleans such as `enabled`.
- Display/configuration text such as `title`, `model_id`, and `base_url` unless a real query needs it.
- JSON text such as `models_json`.

Current important indexes:

- `idx_llm_model_profiles_provider_id`
- `idx_agent_sessions_parent_session_id`
- `idx_agent_sessions_provider_id`
- `idx_agent_sessions_created_at`
- `idx_agent_sessions_type_created_at`
- `idx_agent_sessions_updated_at`
- `idx_chat_messages_session_created_at`

## API Boundaries

- `/api/settings/llm-providers`: provider enablement, base URL, model list, and provider-owned secret env vars.
- `/api/settings/model-profiles`: global default provider/model/parameters for fast helper, conversation, and agentic work.
- `/api/settings/history`: global thinking/tool history replay preferences for subsequent model turns.
- `/api/agent-sessions`: persisted session metadata creation and listing, with computed message and word counts.
- `/api/agent-sessions/:id`: persisted session metadata plus chronological transcript messages.
- `/api/setup`: first-run completion plus optional personalization and advanced model catalog URL.
- `/api/session`: process/session snapshot that includes sanitized provider summaries and model profiles.

## Validation Checklist

For storage changes:

1. Add a new migration version.
2. Keep repositories as the only SQL-owning application modules.
3. Update route validation for every browser-provided field.
4. Update shared protocol types with sanitized data only.
5. Update `docs/database-schema.md`.
6. Run `bun run check`.
7. For migration/index work, create a temp DB and inspect tables/indexes with SQLite PRAGMAs.

Example temp DB inspection:

```ts
import { openAppDatabase } from "./src/server/storage/database.ts";

const appDb = openAppDatabase("temp/truss.db");
for (const table of ["llm_provider_settings", "llm_model_profiles", "agent_sessions"]) {
  console.log(table, appDb.db.query(`PRAGMA index_list(${table})`).all());
}
appDb.db.close();
```
