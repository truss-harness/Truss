# Agentic And Sub-Agentic Mode

Status: Implemented

## Scope

- Agentic mode uses a real multi-turn tool loop until a natural terminal response, the configured agentic tool turn limit, or the hard consecutive tool-failure guard.
- Conversation mode keeps a single tool-use batch and then asks the model for a final answer.
- `modeOverride` on `POST /api/chat` applies the selected conversation/agentic behavior to one turn without mutating `agent_sessions.type`.
- Agentic turns can call the internal `spawn_sub_agent` tool. It creates a `sub-agent` session linked by `parent_session_id`, runs a bounded child loop, and returns the child's final answer to the parent.
- Sub-agent chips render in the parent thinking panel and open a local right-side read-only transcript panel.
- MCP reload waits for the new runtime to settle into connected or failed server states before returning.

## Storage

- `agent_sessions.parent_session_id` is the sub-agent hierarchy link.
- `rich_feature_settings.agentic_tool_turn_limit_enabled` defaults to `1`.
- `rich_feature_settings.agentic_tool_turn_limit` defaults to `300`.

## Protocol

- Chat request: `modeOverride?: "conversation" | "agentic"`.
- Parent chat stream events: `sub_agent.spawned`, `sub_agent.status`, `sub_agent.delta`, `sub_agent.thinking_delta`, `sub_agent.tool_call`, and `sub_agent.message`.
- Global SSE events: `sub_agent.spawned` and `sub_agent.status`.

## UI

- Settings -> AI Behaviour contains the agentic tool turn limit enable/unlimited control.
- The conversation header mode toggle remains interactive after the first message and explains that it applies only to the next message.
- Sub-agent panel state is local React state and is not persisted across reloads.
