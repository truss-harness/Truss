<center><img src="logo.webp" width="300" alt="Truss logo"></center>

# Truss

Truss is a local, single-user AI workspace for Windows. It runs on `localhost`,
keeps its state in your user profile, connects to hosted or local models, and
lets you give agents controlled access to files, terminals, MCP servers,
browser tools, schedules, and workspace-specific history.

It is FOSS under the [Apache-2.0 License](LICENSE). Truss is currently
**Windows x64 only**. It is not a hosted service, a shared multi-user system,
or a security boundary for untrusted users.

![Main screen](./gh-assets/truss-main-screen.png)

## Install from a GitHub Release

Each Windows release has two distribution formats:

| Package | Use it when | Install |
| --- | --- | --- |
| `truss-setup-<version>.exe` | You want normal Windows integration. | Run the elevated installer. It installs the required global Windows service and adds Start Menu/tray integration. |
| `truss-windows-x64-<version>.zip` | You want an inspectable package. | Extract it and run the install script from an elevated PowerShell session. |

Both routes install under `%ProgramFiles%\Truss` and require administrator
rights. The mandatory `LocalSystem` service owns the global server, its
`%ProgramData%\Truss` home, and browser runtime.

After installation, open **Truss** from Start, use the tray menu, or run:

```powershell
truss spawn # Spawn in global mode
truss spawn C:\work\project # Spawn in a specific workspace
```

The installer also adds **Spawn Truss agent here** to folder context menus.
Uninstall from Windows Settings > Apps, or with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:ProgramFiles\Truss\uninstall-truss.ps1" -RemoveFiles
```

Uninstall intentionally leaves `%ProgramData%\Truss` intact so that updating to a new version does not lose settings and history. Remove that
directory yourself only when you also want to remove local conversations,
settings, MCP configuration, and encrypted secrets. The installer and portable
package details are in [packaging/windows/README.md](packaging/windows/README.md).

![Truss tray menu with open, folder, and process controls](gh-assets/windows/tray-menu.png)

## Quick start

1. Start Truss and open `http://127.0.0.1:7805/` when it does not open
   automatically. 7805 is the standard port. For newly spawned agents, and/or if its not available, Truss randomly chooses another port.
2. Configure a model provider in **Settings > Connections**.
3. Start a conversation or select a workspace.
4. Grant directories, enable tools, and approve actions only when you intend to
   give the agent that access.

Truss currently supports Ollama, llama.cpp, OpenAI, OpenRouter, and other
OpenAI-compatible endpoints. Provider credentials are write-only in the UI and
stored in Truss's local encrypted file.

## For power users

### Scope the process to a workspace

```powershell
# Global conversation view; runtime context is the current directory.
truss spawn

# Scope conversations, agent sessions, skills, and workspace MCP discovery.
truss spawn C:\work\project

# Use a predictable port.
truss spawn C:\work\project --port 17771
```

Without an explicit workspace path, Truss starts in global conversation mode.
With a path (including `.`), stored conversations and agent sessions are scoped
to that workspace. The default port is `7805`; when it is unavailable, Truss
chooses a local fallback unless `--port` was specified. `--no-open` and
`--no-autolaunch` are aliases.

Every spawned server is local and independent. **Settings > Processes** lists
active spawned servers, their workspaces, PIDs, ports, and latest activity.
Terminate a server there when it is no longer needed. An unattended, idle spawned
server expires after one hour without UI or API activity and closes its managed
MCP child processes.

![Truss command-line startup output](gh-assets/windows/cli.png)

![Conversation context menu](gh-assets/chat/conversation-context-menu.png)

## Truss features

### Workspaces, history, and scheduled work

- Keep global conversations separate from workspace-scoped work.
- Search and manage stored conversations from the sidebar.
- Create and run scheduled tasks; task runs are recorded as sessions.
- Use the activity pane to inspect timers, terminal processes, and shared files.
- Use multiple scoped processes when separate projects need separate runtime
  contexts.

![Workspace picker and scheduled-task menu](gh-assets/windows/workspaces-and-scheduled-tasks.png)

![Activity pane with a timer, terminal, and shared file](gh-assets/chat/activity-panel.png)

![Activity pane file section](gh-assets/chat/activity-panel-files.png)

### MCP, skills, and browser automation

Truss discovers configured MCP servers skills in workspace mode from other harnesses ( Claude Code, Codex, Cursor, GitHub Copilot, and Junie). Its first-party managed MCP entries are chat, filesystem, command runner,
sub-agent orchestration, web search and simple web fetch, and optional Playwright browser tools.

External MCP configuration lives in `%ProgramData%\Truss\mcp.json`. Save and
reload it from Settings; external stdio commands require explicit approval
before Truss starts them. Remote MCP credentials can be stored as encrypted
`TRUSS_MCP_*` environment values.

![MCP status and discovered skills](gh-assets/configuration/mcp-status.png)

![Discovered local and external skills](gh-assets/chat/discovered-skills.png)

![MCP credentials and editable global configuration](gh-assets/configuration/mcp-settings.png)

The managed web tools use one always-headless Camoufox browser owned and lazily
started by the global Windows service for search, webpage loading, screenshots,
and controlled browser automation. This browser is a patched Firefox
that can bypass most anti-bot screens. Truss automatically installs uBlock origin with multiple filters, so that advertising, cookie notices, etc. does not pollute the LLM's context window. The optional
Playwright MCP server forwards browser work through the same authenticated
loopback broker. Browser tools never launch a process-local fallback.

![Playwright Browser MCP settings](gh-assets/configuration/camoufox-playwright.png)

![Webpage sanitization result](gh-assets/configuration/webpage-sanitizer.png)

### Tune context and execution

- Use conversation and agentic system prompts with documented placeholders.
- Configure if thinking trace, and tool-history is added in the context or not.
- Cap reasoning time or words and cap agentic tool turns when a task needs
  bounded execution. Truss will terminate the thinking phase and follow-up with a new one and attempts to force the model into giving a final answer immediately.
- View structured tool activity and edit or review post-execution results.

![Thinking, tool-history, reasoning-budget, and agentic-turn controls](gh-assets/configuration/reasoning-and-history.png)

![Expanded search and activity details](gh-assets/chat/expanded-search.png)


![Post-edit review dialog](gh-assets/chat/post-edit-review.png)

### Files and attachments

Truss accepts supported local attachments, converts supported documents for
chat use, tracks shared files in the activity pane, and can render attachment
pages as images after confirmation. Image attachments can be redacted locally
before use.

![Document attachment conversion](gh-assets/chat/attachment-conversion.png)

![Local image-redaction editor](gh-assets/chat/image-redaction.png)

## Feature inventory

### Chat and agents (Basic stuff)

- Streaming assistant responses (Very standard)
- Conversation and agentic modes with independent model profiles.
- Parallel tool calls, structured tool status, cancellation, and user-choice
  requests.
- Sub-agents, task orchestration, timers, and scheduled tasks.
- Persistent conversations, messages, thinking/tool-history preferences, and
  workspace filtering.
- Conversation search, rename, duplicate, delete, and automatic title support.

### Models and configuration

- Hosted, local, and custom OpenAI-compatible providers.
- Model profiles for fast helper, conversation, and agentic work.
- System-prompt editing, setup personalization, rich-markdown preferences, and
  reasoning controls.
- Markdown extensions for tables, timelines, cards, callouts, KaTeX, PlantUML,
  maps, and calendar-oriented content where enabled.

### Tools and integrations

- Managed MCP servers for chat, filesystem access, command execution,
  orchestration, web tools, and optional Playwright browser automation.
- External MCP discovery, configuration, encrypted credentials, status,
  resources, prompts, and reload controls.
- Local skills discovery and injection.
- Command terminals with streamed output and termination controls.
- Web search, webpage loading, sanitization, screenshots, and a service-owned,
  always-headless Camoufox runtime.


## Security model and boundaries

Truss is designed to make tool access visible and configurable.

The security model has three relevant layers:

1. **Filesystem guard**: explicit directory grants, read-only support, workspace
   scope, and ignore patterns for sensitive paths.
2. **Command pre-execution guard**: classifies command requests and supports
   safe/risky/dangerous auto-action policies, approval, or denial.
3. **Command output guard**: checks output before it is returned to the model
   and can block or redact sensitive material and prompt-injection content.

![Truss filesystem and command-runner security model](gh-assets/security/security-model.png)

Filesystem grants are explicit and time-limited by default. Ignore patterns
protect common sensitive-file names; grant scope and read-only status are
visible in Settings. Command-runner allowlists do not grant filesystem access
or bypass the output guard.

![Guard assessment attached to a completed command](gh-assets/security/security-settings-1.png)

![Filesystem grants and ignored-file patterns](gh-assets/security/security-settings-2.png)

![Command guard policies and auto-action levels](gh-assets/security/security-settings-3.png)

![Command whitelist management](gh-assets/security/security-settings-4.png)

![Explicit local file-access approval](gh-assets/security/security-settings-5.png)

![Ignored sensitive path blocked by filesystem tools](gh-assets/security/security-settings-6.png)

![Selecting a command guard model and enabling guards](gh-assets/security/security-settings-7.png)

![Dangerous terminal launch rejected by the command guard](gh-assets/security/security-settings-8.png)

![One-time approval dialog for a dangerous command](gh-assets/security/security-settings-9.png)

Security controls reduce accidental exposure and make decisions auditable in
the UI. They do not make arbitrary models, prompts, MCP servers, commands, or
third-party services safe. Do not grant access to data or directories you
cannot afford to expose, and inspect external MCP configuration before
approving it. See [docs/security.md](docs/security.md) for the detailed model.

## Local data and privacy

Truss stores its local state under `%USERPROFILE%\.truss`:

- `truss.db`: SQLite data for settings, conversations, messages, workspace
  scope, scheduled tasks, and related local state.
- `.env`: A file storing encrypted secret values.
- `.env.keys`: Private key, required to decrypt `.env`.
- `mcp.json`: the global MCP configuration.

The frontend never receives actual secret values. Model requests,
MCP connections, web tools, and browser actions can communicate with external
services when you configure or invoke them.

## Build from source

Source development requires Bun 1.3 or newer. From the repository root:

```powershell
bun install
bun run start
```

For development with rebuild/watch behavior:

```powershell
bun run dev
```

Useful validation commands:

```powershell
bun run check
bun test
bun run build
```

Build the Windows release artifacts:

```powershell
bun run package:windows
bun run package:windows:installer
```

The second command requires Inno Setup. Full package-building notes are in
[packaging/windows/README.md](packaging/windows/README.md).

## Documentation

> [!NOTE]
> These were used as context information for coding agents working on Truss implementation-

- [Architecture](docs/software-architecture.md)
- [Protocol contract](docs/protocol-contract.md)
- [Database schema](docs/database-schema.md)
- [Settings reference](docs/settings.md)
- [Security model](docs/security.md)
- [Truss-flavored Markdown](docs/truss-flavored-markdown.md)
- [Third-party attributions](docs/attributions.md)

## License

Truss is licensed under [Apache-2.0](LICENSE).

## Contact

The project maintainer is Bálint Molnár-Kaló, get in contact on [Hugging Face](https://huggingface.co/molbal), [Substack](https://molbal94.substack.com/) or [LinkedIn](https://www.linkedin.com/in/balint-molnar/).