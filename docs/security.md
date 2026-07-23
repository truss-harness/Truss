# Security

This file records security features that are currently implemented in Truss.

## Markdown Rendering

- Chat markdown is parsed into React elements and rendered as text nodes.
- Raw HTML from model output is not interpreted.
- The renderer avoids browser HTML for model-authored raw HTML. KaTeX rendering uses `dangerouslySetInnerHTML` only with MathML generated locally by the `katex` package from dollar-delimited math input.
- Markdown input is normalized before parsing. Control characters are removed except tabs and line breaks.
- Inline links are sanitized before they become anchors. `http`, `https`, `mailto`, relative paths, and fragment links are allowed. `javascript:`, `data:`, `vbscript:`, protocol-relative URLs, and other explicit schemes are suppressed.
- Suppressed links render as inert text instead of clickable anchors.
- Smart Events are parsed only when enabled. Calendar links and ICS files are generated from parsed event attributes rather than from raw HTML.
- Timeline blocks are parsed only when enabled. Timeline labels, titles, descriptions, and icon names render as React text nodes.
- Map blocks embed OpenStreetMap in an iframe when valid coordinates are supplied.

## Code Blocks

- Fenced code blocks are displayed as inert text.
- Syntax highlighting is token-based and does not execute code.
- The copy button writes the literal code text to the clipboard.
- The save button creates a `text/plain` download from a `Blob`; it does not run or import the code.
- Code block language labels are sanitized before they are used for CSS classes or file extensions.
- PlantUML rendering only activates when enabled. PlantUML source is encoded into an image URL for the configured HTTP or HTTPS PlantUML server; otherwise it remains an inert code block.

## Scope Notes

- These safeguards prevent markdown rendering from executing model output in the browser.
- They do not judge whether copied or downloaded code is safe to run later.
- Browser tools are Windows-only. The mandatory `LocalSystem` Truss service owns one lazily started, always-headless Camoufox and exposes fetch, screenshot, and Playwright forwarding on a separate loopback broker. Every broker request requires a random per-service capability token. The token is held in memory and passed only to service-launched workspace processes and Truss-managed browser MCP children; it is not exposed through the UI API or persisted in `mcp.json`. Directly invoked MCP servers and uncredentialed processes wait at most 15 seconds, then fail without a local browser fallback. Screenshot bytes remain binary on the broker transport, and client cancellation is forwarded to the service operation.
- Truss Chat Tools are exposed through a bundled stdio MCP server. Managed Truss entries pass `--workspace-path` only for scoped launches, so conversation listing, search, and deletion are filtered by `agent_sessions.workspace_path`. When Truss starts without a workspace path, those tools can access all conversations, including workspace-scoped ones. The same server can replace the global `mcp.json` file when the tool arguments include explicit overwrite confirmation. The `ask_user_choice` tool is browser-mediated by the Truss host: the backend validates the submitted option or custom text against the pending dialog before returning it to the model. Treat these tools as local data, configuration mutation, and user-input surfaces.
- Truss Filesystem Tools are exposed through a bundled stdio MCP server. Scoped launches use the resolved `workspace_path` as the primary access root. Additional directory grants are stored in `filesystem_directory_grants` for the active workspace path; global-mode grants use `workspace_path = NULL`, and `read_only = 1` marks grants that can be listed, searched, and read but not mutated. The isolation invariant is that a grant is visible only to the launch context it was created in: workspace A grants do not appear in workspace B or global mode, and global grants do not appear in scoped workspace mode. Managed Truss config disables the filesystem server in global mode until at least one global grant exists. Every requested path is resolved against the active root set and rejected if it escapes those roots. Revocation deletes the grant row and the Settings UI reloads MCP servers immediately, so subsequent filesystem tool checks run without the revoked root. Write, patch, move, copy, delete, and directory-creation tools are local filesystem mutation surfaces and reject paths covered by read-only roots; text reads reject likely binary files, and regex search accepts either a directory or one file while skipping likely binary files.
- Tool arguments and results are stored in the local SQLite transcript as assistant thinking metadata. Sensitive URLs or page content requested by the user can therefore become local conversation history.
- Runtime command execution, tool approvals, and MCP calls are separate security surfaces and should continue to be documented when those controls change.
