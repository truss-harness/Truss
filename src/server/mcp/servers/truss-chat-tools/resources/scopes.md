# Truss Scopes: Global vs. Workspace

Truss operates in two primary modes that determine which data is visible and which filesystem areas are accessible.

## Global Scope
When launched without a specific directory (e.g., `truss spawn`), Truss runs in **Global Scope**.
- **Conversations**: Access to all conversations stored in the database, regardless of their workspace association.
- **Filesystem**: Access is restricted to explicitly granted global directories or the user's home directory (if granted).
- **MCP Servers**: Standard global MCP servers are loaded.

## Workspace Scope
When launched within a directory or with a path argument (e.g., `truss spawn .`), Truss runs in **Workspace Scope**.
- **Conversations**: By default, the UI and tools like `list_conversations` filter to show only sessions associated with that specific absolute path.
- **Filesystem**: The workspace root is automatically granted as a primary read/write root for `truss-filesystem-tools`.
- **Context**: The LLM is provided with information about the active workspace to better assist with project-specific tasks.

## Scope Transitions
- **Session Association**: New conversations created in a workspace-scoped launch are tagged with that workspace's path.
- **MCP Reloading**: Changing scope or updating directory grants triggers a reload of MCP servers to ensure permission boundaries are correctly enforced.
- **Isolation**: Workspace-scoped sessions are isolated to prevent data leakage between different projects, while Global scope provides a "bird's eye view" of all activity.

## Tool Behavior
- `list_conversations`: Respects the active scope by default but can be configured to search globally.
- `request_directory_access`: Can grant permissions to either the current workspace (temporary/project-specific) or the global context (persistent).
