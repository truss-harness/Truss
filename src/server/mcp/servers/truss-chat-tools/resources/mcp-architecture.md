# Truss MCP Architecture

Truss is a sophisticated MCP (Model Context Protocol) host and client. It leverages MCP to extend the capabilities of LLMs with specialized tools, resources, and prompts.

## Config Management
Truss loads MCP server definitions from `mcp.json` located in the Truss home directory.
- Supports both Claude-style `mcpServers` and simplified `servers` collections.
- **Managed Servers**: Entries with `"_trussManaged": true` are automatically configured and updated by Truss.
- **Manual Overrides**: Setting `"_trussManaged": false` stops Truss from auto-updating that server's configuration (useful for custom arguments or env vars).

## Built-in MCP Servers
Truss bundles several first-party MCP servers:
- **truss-chat-tools** / Truss Chat Tools: Conversation management, search, and system documentation.
- **truss-filesystem-tools** / Truss Filesystem Tools: Safe, grant-based filesystem access (read/write/search).
- **truss-command-runner** / Truss Command Runner: Secure shell command execution with guard-model verification.
- **truss-web-tools** / Truss Web Tools: Web search and markdown-optimized page loading via Camoufox.
- **truss-orchestration-tools** / Truss Orchestration Tools: Sub-agent spawning and task planning.
- **truss-playwright-mcp** / Truss Playwright Browser: Interactive browser automation (opt-in).

## Execution Flow
1. **Discovery**: Truss connects to servers via stdio or SSE and negotiates capabilities.
2. **Tool Calls**: When a model requests a tool, Truss routes the call to the appropriate MCP server.
3. **Resource Reading**: Documentation resources are read through `resources/read`.
4. **Progress Tracking**: Long-running tools use `notifications/progress` to update the Truss UI.
5. **Security**: Sensitive operations (like command execution or broad filesystem access) require explicit user approval via UI dialogs.

## Secrets & Environment
Credentials should be stored in the Truss `.env` file (managed via `TRUSS_MCP_*` variables) rather than being hardcoded in `mcp.json`. Truss automatically injects these into the MCP server processes.
