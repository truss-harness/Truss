# Truss Chat Structure

Truss stores local chat data and settings in a SQLite database at its home directory.
This documentation helps MCP agents understand how conversations are structured and persisted.

## Database Location
The SQLite database is typically found at:
- Windows: `%USERPROFILE%\.truss\truss.db`
- macOS/Linux: `~/.truss/truss.db`

## Core Tables

### `agent_sessions`
This table stores metadata for every conversation.
- `id`: Unique session identifier.
- `type`: Category of the session (`conversation`, `agentic`, or `sub-agent`).
- `parent_session_id`: For `sub-agent` sessions, points to the parent `agent_sessions` row.
- `workspace_path`: Absolute path to the working directory for workspace-scoped sessions. `NULL` for global sessions.
- `title`: Optional display title for the conversation.
- `provider_id` / `model_id`: Snapshots of the LLM configuration used for this session.
- `created_at` / `updated_at`: ISO timestamps.

### `chat_messages`
Stores the actual transcript messages.
- `id`: Unique message identifier.
- `session_id`: Foreign key to `agent_sessions`.
- `role`: `user` or `assistant`.
- `content`: The text content of the message.
- `attachments_json`: JSON array of sanitized attachments.
- `thinking_content`: Reasoning/thinking text from the assistant (if supported by the model).
- `tool_calls_json`: JSON array of MCP tool-call metadata (arguments, results, errors).

## Session Types
- **Conversation**: Standard chat mode.
- **Agentic**: Specialized workspace-agent mode with enhanced tool access.
- **Sub-agent**: Ephemeral or task-specific session spawned by another session.

## Data Lifecycle
- **Persistence**: Messages are saved immediately to SQLite.
- **Cascading Deletes**: Deleting a session automatically removes all its messages and any child sub-agent sessions via foreign key cascades.

## API Access
Truss provides internal HTTP endpoints for the UI:
- `GET /api/agent-sessions`: Lists sessions (scoped or global).
- `POST /api/agent-sessions`: Creates a new session.
- `GET /api/agent-sessions/:id`: Retrieves session details and full message transcript.
- `POST /api/chat`: Streams LLM responses and manages tool execution loops.
