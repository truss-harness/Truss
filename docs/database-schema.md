# Database Schema

Truss uses one SQLite database at `~/.truss/truss.db`. Conversations can be
scoped to a working directory through `agent_sessions.workspace_path`.
`truss spawn [workspace path]` selects a scoped conversation view; plain
`truss spawn` uses the current working directory for runtime context but can
access conversations from all workspaces.

Schema ownership lives in:

- `src/server/storage/database.ts`: opens SQLite, enables foreign keys, and runs migrations.
- `src/server/storage/migrations.ts`: creates and evolves tables and indexes.
- `src/server/storage/settings.ts`: LLM provider settings repository.
- `src/server/storage/model-profiles.ts`: global model profile repository.
- `src/server/storage/system-prompts.ts`: conversation and agentic system prompt templates.
- `src/server/storage/history-settings.ts`: prompt history replay preferences.
- `src/server/storage/mcp-settings.ts`: bundled MCP tool preferences.
- `src/server/storage/filesystem-directory-grants.ts`: workspace-scoped and global-only Truss Filesystem Tools directory grants.
- `src/server/storage/rich-feature-settings.ts`: rich markdown renderer preferences and prompt hints.
- `src/server/storage/agent-sessions.ts`: conversation, agentic, and sub-agent session metadata repository with optional workspace filtering.
- `src/server/storage/chat-messages.ts`: persisted user and assistant chat transcript messages with optional workspace-filtered search.
- `src/server/storage/setup.ts`: first-run setup and optional personalization repository.

Secrets are not stored in SQLite. Provider API keys and MCP credentials are stored through dotenvx in `~/.truss/.env` with private key material in `~/.truss/.env.keys`.

## Tables

### `schema_migrations`

Tracks applied schema migrations.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `version` | `INTEGER` | `PRIMARY KEY` | Migration version. |
| `applied_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- `version` is an `INTEGER PRIMARY KEY`, so SQLite stores it as the rowid. No secondary index is needed.

### `llm_provider_settings`

Stores non-secret settings for each known LLM provider.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `provider_id` | `TEXT` | `PRIMARY KEY` | Stable provider ID such as `openai`, `openrouter`, `ollama`, or `llamacpp`. |
| `enabled` | `INTEGER` | `NOT NULL`, `CHECK (enabled IN (0, 1))` | Boolean provider enablement. |
| `base_url` | `TEXT` | nullable | User override for provider endpoint. |
| `default_model` | `TEXT` | nullable | Provider-level default model. |
| `models_json` | `TEXT` | `NOT NULL DEFAULT '[]'` | JSON array of known or manually configured model IDs. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- SQLite implicit primary-key index on `provider_id`.

### `llm_model_profiles`

Stores global model defaults for common model-selection roles.

Valid profile IDs:

- `fast-helper`
- `conversation`
- `agentic`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `profile_id` | `TEXT` | `PRIMARY KEY`, `CHECK (profile_id IN (...))` | Stable global profile ID. |
| `label` | `TEXT` | `NOT NULL` | UI label seeded from code. |
| `description` | `TEXT` | `NOT NULL` | UI description seeded from code. |
| `provider_id` | `TEXT` | `NOT NULL`, FK to `llm_provider_settings(provider_id)` | Provider used by this profile. |
| `model_id` | `TEXT` | `NOT NULL` | Model ID for this profile. |
| `temperature` | `REAL` | nullable, `CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2))` | Sampling temperature. |
| `top_p` | `REAL` | nullable, `CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1))` | Nucleus sampling threshold. |
| `top_k` | `INTEGER` | nullable, `CHECK (top_k IS NULL OR top_k >= 0)` | Top-k sampling threshold. |
| `context_size` | `INTEGER` | nullable, `CHECK (context_size IS NULL OR context_size > 0)` | Context window size. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Foreign keys:

- `provider_id` references `llm_provider_settings(provider_id)` with `ON UPDATE CASCADE` and `ON DELETE RESTRICT`.

Indexes:

- SQLite implicit primary-key index on `profile_id`.
- `idx_llm_model_profiles_provider_id` on `provider_id`.

### `mcp_settings`

Stores singleton preferences for bundled MCP tools.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | Singleton row. |
| `sanitizer_provider_id` | `TEXT` | nullable | Provider used by Truss Web Tools webpage cleanup when set. |
| `sanitizer_model_id` | `TEXT` | nullable | Model used by Truss Web Tools webpage cleanup when set. |
| `command_runner_guard_provider_id` | `TEXT` | nullable | Provider used by Command Runner guard checks when set. |
| `command_runner_guard_model_id` | `TEXT` | nullable | Model used by Command Runner guard checks when set. |
| `command_runner_pre_guard_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (command_runner_pre_guard_enabled IN (0, 1))` | Whether command intent is checked before process execution. |
| `command_runner_post_guard_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (command_runner_post_guard_enabled IN (0, 1))` | Whether stdout/stderr is checked before returning command output to the model. |
| `command_runner_safe_action` | `TEXT` | `NOT NULL DEFAULT 'auto-allow'`, `CHECK (command_runner_safe_action IN (...))` | Guard action for commands classified as safe. |
| `command_runner_risky_action` | `TEXT` | `NOT NULL DEFAULT 'ask'`, `CHECK (command_runner_risky_action IN (...))` | Guard action for commands classified as risky. |
| `command_runner_dangerous_action` | `TEXT` | `NOT NULL DEFAULT 'ask'`, `CHECK (command_runner_dangerous_action IN (...))` | Guard action for commands classified as dangerous. |
| `playwright_mcp_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (playwright_mcp_enabled IN (0, 1))` | Whether the managed `truss-playwright-mcp` entry is active. |
| `playwright_mcp_headless` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (playwright_mcp_headless IN (0, 1))` | Whether the Playwright Browser MCP Camoufox launcher runs headless. |
| `playwright_mcp_tools` | `TEXT` | `NOT NULL DEFAULT '*'` | Comma/newline allowlist of upstream Playwright MCP tool names; `*` exposes all. |
| `playwright_mcp_shared_browser` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (playwright_mcp_shared_browser IN (0, 1))` | Whether the runtime uses Truss's process-local shared Camoufox lease. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- `id` is an `INTEGER PRIMARY KEY`, so SQLite stores it as the rowid. No secondary index is needed.

### `filesystem_directory_grants`

Stores additional directories granted to Truss Filesystem Tools for one launch context.
The workspace root itself is not stored here; scoped launches add the resolved
`workspace_path` as the primary runtime root.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY` | Rowid. |
| `workspace_path` | `TEXT` | nullable | Absolute workspace path this grant belongs to. `NULL` means a global-only grant. |
| `directory_path` | `TEXT` | `NOT NULL` | Absolute granted directory path. |
| `granted_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `expires_at` | `TEXT` | nullable for legacy rows | ISO timestamp when the grant expires. |
| `grant_source` | `TEXT` | `NOT NULL`, `CHECK (grant_source IN ('user-dialog', 'cli-arg'))` | How the grant was created. |
| `read_only` | `BOOLEAN` | `NOT NULL`, default `0`, `CHECK (read_only IN (0, 1))` | Whether mutating filesystem MCP tools are blocked for this grant. |

Indexes:

- `idx_filesystem_directory_grants_workspace_directory` is unique on `(workspace_path, directory_path)` for workspace contexts.
- `idx_filesystem_directory_grants_global_directory` is unique on `directory_path` where `workspace_path IS NULL`, because SQLite allows duplicate `NULL` values in ordinary unique composite indexes.

### `agent_sessions`

Stores session metadata for conversations, agentic sessions, and sub-agents. It
snapshots provider, model, generation parameters, and optional workspace scope at
creation time.

Valid session types:

- `conversation`
- `agentic`
- `sub-agent`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Stable generated session ID. |
| `type` | `TEXT` | `NOT NULL`, `CHECK (type IN (...))` | Session category. |
| `parent_session_id` | `TEXT` | nullable, FK to `agent_sessions(id)` | Required only for `sub-agent`. |
| `title` | `TEXT` | nullable | Optional display title. |
| `provider_id` | `TEXT` | `NOT NULL`, FK to `llm_provider_settings(provider_id)` | Provider snapshot. |
| `model_id` | `TEXT` | `NOT NULL` | Model snapshot. |
| `temperature` | `REAL` | nullable, `CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2))` | Sampling temperature snapshot. |
| `top_p` | `REAL` | nullable, `CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1))` | Nucleus sampling snapshot. |
| `top_k` | `INTEGER` | nullable, `CHECK (top_k IS NULL OR top_k >= 0)` | Top-k sampling snapshot. |
| `context_size` | `INTEGER` | nullable, `CHECK (context_size IS NULL OR context_size > 0)` | Context size snapshot. |
| `workspace_path` | `TEXT` | nullable | Absolute working directory path for workspace-scoped sessions. `NULL` means unscoped/global. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Additional checks:

- `sub-agent` rows must have `parent_session_id`.
- Non-`sub-agent` rows must not have `parent_session_id`.
- `parent_session_id` must not equal `id`.

Foreign keys:

- `parent_session_id` references `agent_sessions(id)` with `ON UPDATE CASCADE` and `ON DELETE CASCADE`.
- `provider_id` references `llm_provider_settings(provider_id)` with `ON UPDATE CASCADE` and `ON DELETE RESTRICT`.

Indexes:

- SQLite implicit primary-key index on `id`.
- `idx_agent_sessions_parent_session_id` on `parent_session_id`.
- `idx_agent_sessions_provider_id` on `provider_id`.
- `idx_agent_sessions_created_at` on `created_at DESC`.
- `idx_agent_sessions_type_created_at` on `(type, created_at DESC)`.
- `idx_agent_sessions_updated_at` on `updated_at DESC`.
- `idx_agent_sessions_workspace_path_updated_at` on `(workspace_path, updated_at DESC)`.

### `chat_messages`

Stores persisted transcript messages for conversation and agentic sessions.
The repository also derives per-session message and word counts for history UI without storing duplicate aggregate columns.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Stable generated message ID. |
| `session_id` | `TEXT` | `NOT NULL`, FK to `agent_sessions(id)` | Owning session. |
| `role` | `TEXT` | `NOT NULL`, `CHECK (role IN ('user', 'assistant'))` | Persisted user/assistant messages. |
| `content` | `TEXT` | `NOT NULL` | Message content. May be empty for attachment-only user messages. |
| `attachments_json` | `TEXT` | `NOT NULL DEFAULT '[]'` | JSON array of sanitized chat attachments. |
| `thinking_content` | `TEXT` | nullable | Provider-exposed reasoning text, when available. |
| `thinking_duration_ms` | `INTEGER` | nullable, `CHECK (thinking_duration_ms IS NULL OR thinking_duration_ms >= 0)` | Reasoning duration metadata. |
| `thinking_word_count` | `INTEGER` | nullable, `CHECK (thinking_word_count IS NULL OR thinking_word_count >= 0)` | Reasoning word-count metadata. |
| `tool_calls_json` | `TEXT` | `NOT NULL DEFAULT '[]'` | JSON array of MCP tool-call metadata, including arguments, progress, TOON results, or errors, shown inside the assistant thinking panel. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Foreign keys:

- `session_id` references `agent_sessions(id)` with `ON UPDATE CASCADE` and `ON DELETE CASCADE`.

Indexes:

- SQLite implicit primary-key index on `id`.
- `idx_chat_messages_session_created_at` on `(session_id, created_at ASC)`.

### `first_run_setup`

Stores singleton first-run setup state and optional prompt personalization.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | Singleton row. |
| `completed` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (completed IN (0, 1))` | Whether onboarding is complete. |
| `nickname` | `TEXT` | nullable | Optional prompt personalization. |
| `preferred_language` | `TEXT` | nullable | Optional response-language prompt personalization. |
| `location` | `TEXT` | nullable | Optional region/timezone-style prompt context. |
| `model_catalog_url` | `TEXT` | nullable | Optional advanced GitHub model-defaults catalog URL. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- `id` is an `INTEGER PRIMARY KEY`, so SQLite stores it as the rowid. No secondary index is needed.

### `system_prompt_settings`

Stores editable system prompt templates for conversation and agentic mode.

Valid modes:

- `conversation`
- `agentic`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `mode` | `TEXT` | `PRIMARY KEY`, `CHECK (mode IN ('conversation', 'agentic'))` | Prompt mode. |
| `template` | `TEXT` | `NOT NULL` | Mustache-style prompt template text. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- SQLite implicit primary-key index on `mode`.

### `conversation_history_settings`

Stores singleton AI behaviour preferences for subsequent model turns.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | Singleton row. |
| `include_thinking_history` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (include_thinking_history IN (0, 1))` | Whether provider-exposed assistant thinking is included in later prompt context. |
| `include_tool_history` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (include_tool_history IN (0, 1))` | Whether persisted tool calls/results should be included in later prompt context. The preference is stored, but replay is not active yet. |
| `limit_reasoning_budget` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (limit_reasoning_budget IN (0, 1))` | Whether non-OpenAI reasoning streams are aborted and retried when saved reasoning limits are exceeded. |
| `max_reasoning_time_seconds` | `INTEGER` | `NOT NULL DEFAULT 300`, `CHECK (max_reasoning_time_seconds >= 0)` | Maximum wall-clock seconds allowed after a reasoning phase begins. |
| `max_reasoning_words` | `INTEGER` | `NOT NULL DEFAULT 10000`, `CHECK (max_reasoning_words >= 0)` | Maximum words allowed inside reasoning/thinking content only. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- `id` is an `INTEGER PRIMARY KEY`, so SQLite stores it as the rowid. No secondary index is needed.

### `rich_feature_settings`

Stores singleton rich renderer preferences for Cards, Timeline blocks, follow-up prompts, callouts, markdown tables, Smart Events, PlantUML, and KaTeX.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | Singleton row. |
| `agentic_tool_turn_limit_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (agentic_tool_turn_limit_enabled IN (0, 1))` | Whether agentic turns stop after the configured tool-use turn cap. |
| `agentic_tool_turn_limit` | `INTEGER` | `NOT NULL DEFAULT 300`, `CHECK (agentic_tool_turn_limit >= 0)` | Maximum tool-use turns per agentic run when the cap is enabled. |
| `cards_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (cards_enabled IN (0, 1))` | Whether Card syntax renders as artifact-style containers and prompt guidance. |
| `callouts_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (callouts_enabled IN (0, 1))` | Whether GitHub-style alert syntax renders as styled callouts and prompt guidance. |
| `follow_ups_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (follow_ups_enabled IN (0, 1))` | Whether Follow-up syntax renders above the composer and whether prompt guidance permits follow-up prompts. |
| `timelines_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (timelines_enabled IN (0, 1))` | Whether Timeline syntax renders as compact vertical histories and prompt guidance. |
| `smart_tables_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (smart_tables_enabled IN (0, 1))` | Whether markdown tables render with smart controls and prompt hints. |
| `smart_events_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (smart_events_enabled IN (0, 1))` | Whether Truss calendar syntax renders event chips and prompt syntax guidance. |
| `smart_events_google_calendar_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (smart_events_google_calendar_enabled IN (0, 1))` | Whether Smart Event modals include Google Calendar links. |
| `smart_events_outlook_calendar_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (smart_events_outlook_calendar_enabled IN (0, 1))` | Whether Smart Event modals include Outlook Calendar links. |
| `smart_events_ics_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (smart_events_ics_enabled IN (0, 1))` | Whether Smart Event modals include downloadable ICS files. |
| `plantuml_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (plantuml_enabled IN (0, 1))` | Whether PlantUML fences render through a PlantUML server. |
| `plantuml_server_url` | `TEXT` | `NOT NULL DEFAULT 'https://www.plantuml.com/plantuml'` | PlantUML server root used by the browser renderer. |
| `plantuml_format` | `TEXT` | `NOT NULL DEFAULT 'svg'`, `CHECK (plantuml_format IN ('svg', 'png'))` | Render format appended to the PlantUML server URL. |
| `plantuml_prompt` | `TEXT` | `NOT NULL DEFAULT ''` | PlantUML prompt instructions appended only while PlantUML is enabled. Truss seeds this with default syntax, palette, and sequence-diagram guidance. |
| `katex_enabled` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK (katex_enabled IN (0, 1))` | Whether dollar-delimited math renders with KaTeX. |
| `created_at` | `TEXT` | `NOT NULL` | ISO timestamp. |
| `updated_at` | `TEXT` | `NOT NULL` | ISO timestamp. |

Indexes:

- `id` is an `INTEGER PRIMARY KEY`, so SQLite stores it as the rowid. No secondary index is needed.

## Index Review

SQLite automatically creates indexes for primary keys. Additional indexes are used where a column is part of a child-side foreign key or an active query filter/order.

| Query or constraint | Covered by | Status |
| --- | --- | --- |
| Applied migration lookup by `schema_migrations.version` | SQLite rowid primary key | Covered |
| Provider lookup/update by `llm_provider_settings.provider_id` | Primary-key index | Covered |
| Provider settings list | Full table scan | Appropriate: provider table is tiny and unfiltered. |
| Model profile lookup/update by `llm_model_profiles.profile_id` | Primary-key index | Covered |
| Model profile FK checks by `llm_model_profiles.provider_id` | `idx_llm_model_profiles_provider_id` | Covered |
| Model profile list in fixed profile order | Full table scan plus fixed `CASE` ordering | Appropriate: exactly three rows. |
| Agent session lookup by `agent_sessions.id` | Primary-key index | Covered |
| Agent session parent FK checks and child lookups by `parent_session_id` | `idx_agent_sessions_parent_session_id` | Covered |
| Agent session provider FK checks by `provider_id` | `idx_agent_sessions_provider_id` | Covered |
| Agent session list newest first | `idx_agent_sessions_created_at` | Covered |
| Agent session list latest activity first | `idx_agent_sessions_updated_at` | Covered |
| Workspace-scoped agent session list latest activity first | `idx_agent_sessions_workspace_path_updated_at` | Covered |
| Future filtered session lists by type newest first | `idx_agent_sessions_type_created_at` | Covered |
| Chat transcript lookup by session in chronological order | `idx_chat_messages_session_created_at` | Covered |
| Sidebar message/word stats by session IDs | `idx_chat_messages_session_created_at` | Covered |
| First-run setup singleton lookup by `first_run_setup.id` | SQLite rowid primary key | Covered |
| System prompt lookup/update by `system_prompt_settings.mode` | Primary-key index | Covered |
| AI behaviour settings singleton lookup by `conversation_history_settings.id` | SQLite rowid primary key | Covered |
| Rich feature settings singleton lookup by `rich_feature_settings.id` | SQLite rowid primary key | Covered |
| Filesystem grants by active workspace context | `idx_filesystem_directory_grants_workspace_directory` | Covered |
| Filesystem global grants by directory | `idx_filesystem_directory_grants_global_directory` | Covered |

Columns intentionally not indexed:

- Boolean and low-cardinality settings such as `enabled`.
- Display/configuration text such as `base_url`, `default_model`, `model_id`, and `title`.
- JSON payload columns such as `models_json`.
- Tool metadata JSON such as `tool_calls_json`, because current access is through chronological message reads.
- Timestamp columns on provider settings and model profiles, because current access is by primary key or tiny full-table list.
- Optional personalization fields such as `nickname`, `preferred_language`, `location`, and `model_catalog_url`, because they are read from one singleton row.
- AI behaviour booleans and limits such as `include_thinking_history`, `include_tool_history`, and `limit_reasoning_budget`, because they are read from one singleton row.
- Rich feature booleans and PlantUML text settings, because they are read from one singleton row.
- MCP singleton booleans and allowlist text such as `playwright_mcp_enabled`, `playwright_mcp_headless`, `playwright_mcp_shared_browser`, and `playwright_mcp_tools`, because they are read from one singleton row.

## Migration History

| Version | Purpose |
| --- | --- |
| 1 | Create `llm_provider_settings`. |
| 2 | Create `llm_model_profiles`, `agent_sessions`, and initial agent-session indexes. |
| 3 | Add provider FK indexes, newest-first session index, and composite type/newest-first session index. |
| 4 | Create singleton `first_run_setup` for onboarding completion and optional personalization. |
| 5 | Create `chat_messages` and latest-activity session index for past conversations. |
| 6 | Create `system_prompt_settings` for editable conversation and agentic system prompt templates. |
| 7 | Create `conversation_history_settings` for thinking/tool history replay preferences. |
| 8 | Create `rich_feature_settings` for rich markdown renderer preferences. |
| 9 | Add the `callouts_enabled` rich feature flag. |
| 10 | Seed blank PlantUML prompt instructions with the default Truss PlantUML guidance. |
| 11 | Add reasoning budget controls to `conversation_history_settings`. |
| 12 | Add the `cards_enabled` rich feature flag. |
| 13 | Add the `follow_ups_enabled` rich feature flag. |
| 14 | Add persisted tool-call metadata to `chat_messages`. |
| 15 | Add the `timelines_enabled` rich feature flag. |
| 16 | Create `mcp_settings` for bundled MCP tool preferences. |
| 17 | Add `agent_sessions.workspace_path` and the workspace/latest-activity index. |
| 18 | Create `filesystem_directory_grants` with context-specific uniqueness for workspace and global directory grants. |
| 19 | Add agentic tool turn limit controls to `rich_feature_settings`. |
| 20 | Add expiry timestamps and expiry index to `filesystem_directory_grants`. |
| 21 | Add encrypted thinking storage to `chat_messages`. |
| 22 | Add `filesystem_directory_grants.read_only` for read-only directory grants. |
| 23 | Add Command Runner guard settings and command whitelist entries. |
| 24 | Add `first_run_setup.show_workspace_sessions_in_global_view`. |
| 25 | Change Command Runner dangerous default back to `ask` and add whitelist metadata. |
| 26 | Add Playwright Browser MCP settings to `mcp_settings`. |
