# Settings

The settings screen is served at `/settings` as a standalone React route. It is intentionally separate from the chat workspace layout.

## Tabs

- Connections: manage registered LLM providers through `/api/settings/llm-providers`. Disabled providers show only identity, status, and the enable toggle. Enable a provider to edit its Base URL, default model, and write-only secret rotation fields. The API returns configured/encrypted status but never returns secret values.
- Customization: edit optional `nickname`, `location`, and `preferredLanguage` through `/api/setup`.
- Truss MCP Settings: configure first-party Truss MCP setup help, review active filesystem directory grants, revoke grants for the current context, configure the bundled Playwright Browser MCP server, and set the Truss Web Tools webpage sanitizer model.
- 3rd Party MCP: edit the global `mcp.json` file and stage UI-only working-directory autodiscovery state.
- System prompts: edit conversation and agentic system prompt templates through `/api/settings/system-prompts`. Editors are stacked vertically and include a default-restore action.
- AI behaviour: control reasoning budget limits and whether stored thinking or tool history is replayed into later model turns through `/api/settings/history`, plus the agentic tool turn limit stored with rich feature settings.
- Rich features: control interactive markdown renderers through `/api/settings/rich-features`.
- System: show local storage paths from `/api/settings/system`, including the working directory, conversation scope, and SQLite database path.

## Connections

Each provider card explains what the provider is. Enabled providers also show the current Base URL plus its source:

- `settings`: saved in Truss settings.
- `env`: read from the process environment.
- `default`: the provider's built-in default.

Base URL meaning depends on the provider:

- OpenAI and OpenRouter use hosted OpenAI-compatible API roots.
- OpenAI compliant endpoint uses a custom OpenAI-compatible API root. Include `/v1` when the target server expects that prefix.
- Ollama uses the Ollama server origin, usually `http://127.0.0.1:11434`.
- llama.cpp uses its OpenAI-compatible API root, usually with `/v1`.

Secret fields rotate or remove keys. Existing secret values are never displayed. There is no manual model-list textarea on the settings page; providers are expected to serve model choices through their `/models` endpoint.

## AI behaviour

AI behaviour settings are global. Replay options and reasoning budget limiting default to off.

- Include thinking history with subsequent turns: when enabled, `/api/chat` appends stored provider-exposed thinking from prior assistant messages to those prior assistant messages in the provider prompt payload. The stored transcript itself is not modified.
- Include tool history with subsequent turns: saves the preference for replaying tool calls and tool results into later model context. The current chat path persists MCP tool calls and results on assistant messages, but replay into later provider prompts is not active yet.
- Limit reasoning budget: when enabled, `/api/chat` watches non-OpenAI responses that expose reasoning through provider fields or `<think>...</think>` blocks, and counts MCP tool-running time against the saved time limit. If elapsed reasoning or tool-running time, or reasoning word count, exceeds the saved limits, Truss asks for a direct answer with the same conversation context, prepends `I reasoned enough. Now let me answer directly.`, and asks the provider to disable or exclude reasoning on the retry. Partial thinking from the aborted attempt is copied into the final response after the retry completes.
- Agentic tool turn limit: when enabled, agentic turns stop after the configured number of tool-use batches and return `Agentic turn limit reached (...)`. The default is 300. Disabling the limit leaves only the hard consecutive tool-failure guard.

## MCP Settings

The chat composer's MCP Settings button opens the MCP status modal. It can disable whole MCP servers or individual tools for new messages, and links to `/settings?tab=truss-mcp` for persistent MCP settings.

- Global MCP config: `~/.truss/mcp.json`. Truss loads MCP servers from this appdata file next to the database and dotenvx secret files, refreshes Truss-managed first-party server entries with the current working directory and conversation scope, and can reconnect servers from Settings without a full restart.
- Truss MCP Settings: shows setup instructions for bundled first-party stdio MCP servers, lists active Truss Filesystem Tools grants for the running context, revokes individual grants, stores the Playwright Browser MCP settings, and stores the Webpage Sanitizer provider/model preference.
- 3rd Party MCP: edits the global `mcp.json` file. Saving validates JSON and refreshes Truss-managed defaults. Workspace MCP autodiscovery is automatic for scoped launches and is not written to the global Truss `mcp.json`.
- MCP credentials: stores `TRUSS_MCP_*` secret values in the dotenvx-managed encrypted env file. Remote MCP `auth` blocks reference those environment variable names for API key auth, OAuth2 client credentials, or OAuth2 authorization-code token refresh.
- Truss Web Tools: bundled stdio MCP server for browser-backed web search, webpage loading, and website screenshots. The server starts an app-managed Camoufox browser through a bundled JavaScript launcher when the MCP server starts. Truss downloads the pinned Camoufox release into the Truss home directory on first use and reuses it afterward. It also downloads uBlock Origin `1.71.0` from addons.mozilla.org by default, extracts the XPI into `~/.truss/camoufox-addons`, and loads that extracted add-on through Camoufox config. No Python Camoufox package is required. Set `TRUSS_CAMOUFOX_EXECUTABLE` to use an existing Camoufox executable, `TRUSS_CAMOUFOX_INSTALL_DIR` to change the managed browser directory, `TRUSS_CAMOUFOX_NODE` to use a specific Node executable for the launcher child, `TRUSS_CAMOUFOX_DEFAULT_ADDONS=false` to skip the bundled default add-on, `TRUSS_CAMOUFOX_ADDON_URLS` to download additional comma-separated XPI or ZIP add-ons, or `TRUSS_CAMOUFOX_ADDON_PATHS` to load extracted add-on directories.
- Truss Playwright Browser: bundled stdio MCP server key `truss-playwright-mcp` for Playwright MCP's interactive browser tools through Truss's Camoufox launcher-child adapter. It is written into `~/.truss/mcp.json` as a managed entry but disabled by default. Settings keys are `mcp.playwright_mcp_enabled` (`boolean`, default `false`), `mcp.playwright_mcp_headless` (`boolean`, default `true`), `mcp.playwright_mcp_tools` (`string`, default `*`, comma/newline allowlist of upstream Playwright MCP tool names), and `mcp.playwright_mcp_shared_browser` (`boolean`, default `true`, process-local Camoufox lease sharing when runtimes are hosted together). Enable it, save Truss MCP Settings, and reload MCP servers to connect the server.
- Truss Chat Tools: bundled stdio MCP server for showing user choice dialogs in the active chat, listing/searching conversations visible to the active scope, deleting visible conversations after explicit confirmation, reviewing/editing `mcp.json`, exposing chat/MCP docs as resources, and verifying those MCP docs.
- Truss Command Runner: bundled stdio MCP server for host-mediated shell commands and terminals. By default safe commands auto-allow, risky and dangerous commands ask, and the command whitelist is pre-filled once with exact read-only status/version patterns. A whitelist match skips the pre-execution guard only; filesystem roots and the post-execution output guard still apply.
- Truss Filesystem Tools: bundled stdio MCP server enabled by default for scoped workspace launches and enabled in global mode only after a global directory grant exists. It returns model-visible TOON for file metadata, directory listings, bounded trees with optional extension filters, one or more text files by line range, supported documents converted to Markdown, write/patch acknowledgements, file move/copy/delete operations, directory creation, filename search, and regex content search across directories or individual files with optional context lines. Text and document content use TOON block text when multiline. Text reads reject likely binary files, and the server resolves and checks every path against the workspace root plus grants for the active workspace or global context before touching the filesystem. Workspace grants do not appear in global mode or other workspaces, and global grants do not appear in scoped workspace mode.
- Web search: lets the assistant query DuckDuckGo's HTML search page through Camoufox, unwrap result redirects to their target URLs, limits model-visible results to five, and returns those results as TOON rather than raw search HTML.
- Load webpage: lets the assistant fetch one HTTP or HTTPS URL, or up to five URLs in one tool call, through Camoufox; convert page HTML to Markdown with Pandoc; and use a helper model to remove advertisements, navigation, cookie prompts, and other boilerplate before returning sanitized Markdown.
- Get website screenshot: lets the assistant capture a website screenshot through Camoufox. The screenshot viewport is capped at 1024 by 1920 and is returned as base64 image data with metadata.
- Webpage sanitizer model: defaults to the active chat model fallback unless a provider/model is saved in Truss MCP Settings.

Tool use is stored with the assistant message and appears inside the collapsible thinking panel. Clicking a tool-use row shows the exact arguments and the TOON result or error. MCP tools that emit `notifications/progress` with the request `_meta.progressToken` can also show a short status message and progress bar while they run; a completed `100%` or failed progress bar stays visible for three seconds before fading away.

Agentic turns can use the internal `spawn_sub_agent` tool. Each child is stored as a `sub-agent` session linked to its parent, appears as a sub-agent chip in the parent thinking panel, and opens a read-only side panel with the child transcript.

## Rich Features

Rich feature settings are global and default to off unless noted.

- Smart tables: when disabled, markdown pipe tables render as regular styled HTML tables. When enabled, tables render with sorting, visible-column controls, row paging, and CSV download. `/api/chat` also appends a short prompt hint encouraging clean markdown tables for tabular answers.
- Smart events: when disabled, Truss calendar syntax remains plain text and no event modal is shown. When enabled, `:calendar[...]` entries render as event chips with a details modal, and `/api/chat` appends the event syntax description to the model prompt.
- Smart event actions: Google Calendar links, Outlook Calendar links, and ICS downloads are separate toggles that only appear when Smart events are enabled.
- Timelines: when disabled, `:::timeline` blocks remain plain markdown text. When enabled, Timeline blocks render as compact vertical event histories or ordered steps, including repair instructions, assembly flows, recipes, approvals, and release plans, and `/api/chat` appends the Timeline syntax description to the model prompt.
- Cards: enabled by default. When enabled, `:::card` blocks render as artifact-style containers with hover actions to copy or download the card contents. `/api/chat` also appends card guidance for rephrasing, drafts, summaries, and other paste-ready deliverables, and tells the model not to embed tables or vertical timelines inside Cards.
- Follow-up prompts: enabled by default. When enabled, `:::followups` blocks render as up to three prompt lines above the docked composer instead of inside assistant messages. When disabled, `/api/chat` tells the model not to end replies with follow-up prompts.
- PlantUML: when disabled, PlantUML fences render as code blocks. When enabled, `plantuml` and `puml` fences render through the configured PlantUML server. The server defaults to `https://www.plantuml.com/plantuml`, and rendering can use SVG or PNG. PlantUML prompt instructions default to the Truss palette and sequence-diagram conventions; `/api/chat` appends them to the model prompt while PlantUML is enabled.
- KaTeX rendering: when enabled, `$...$` inline math and `$$...$$` display math render as KaTeX MathML. When disabled, dollar-delimited math remains plain text.
- Callouts: enabled by default. When enabled, GitHub-style alert blocks render as styled callouts and `/api/chat` appends callout guidance to the model prompt. When disabled, alert syntax remains regular markdown text.

Map blocks are part of the markdown renderer and use OpenStreetMap embeds. See `docs/truss-flavored-markdown.md` for syntax.

## Prompt Templates

System prompts use a small Mustache-style subset implemented in `src/server/prompts/system-prompts.ts`.

Supported tags:

- `{{datetime}}`
- `{{location}}`
- `{{nickname}}`
- `{{preferred_response_language}}`
- `{{preferredLanguage}}`
- `{{preferred response language}}`

Optional values should be wrapped in sections so blank customization fields are skipped:

```text
{{#nickname}}The user prefers to be called {{nickname}}.{{/nickname}}
{{#location}}The user's location is {{location}}.{{/location}}
{{#preferred_response_language}}Respond in {{preferred_response_language}} unless the user asks otherwise.{{/preferred_response_language}}
```

Inverted sections are also supported for fallback text:

```text
{{^location}}No user location is set.{{/location}}
```

`/api/chat` renders the saved template on each request. Conversation mode uses the `conversation` template and agent mode uses the `agentic` template.

## Storage

- Conversation scope: when `truss spawn [workspace path]` includes a path, conversations are limited to that working directory. Plain `truss spawn` has access to all conversations, including workspace-scoped ones.
- Working directory: the current runtime directory used for MCP discovery, skills, and process working context.
- Database: `~/.truss/truss.db`. Stores provider settings, model profiles, prompt templates, history preferences, rich feature preferences, setup customization, conversations, messages, each conversation's working directory scope, and filesystem directory grants by workspace or global context. Provider API keys are not stored here.
- Truss home: `~/.truss`. The local data directory that contains the database and dotenvx files.
- MCP config: `~/.truss/mcp.json`. Stores global MCP server definitions loaded by Truss.
- Encrypted secrets: `~/.truss/.env`. dotenvx-managed environment file for provider API keys and MCP credentials. Values are written encrypted and are never returned to the settings screen.
- Secret key material: `~/.truss/.env.keys`. dotenvx private key material needed to decrypt local secrets. Keep it local and private.

Update `docs/database-schema.md` whenever settings storage changes.
