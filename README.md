# Truss

Truss is a single-user localhost agentic chat harness. It pairs a Bun TypeScript
backend with a React frontend, stores local state in SQLite, streams chat state
over Server-Sent Events, and connects local or hosted LLM providers with MCP
tools.

## Requirements

- Bun 1.3 or newer.
- Node-compatible shell tooling for Sass and Tailwind build steps.
- Optional local or hosted model providers: Ollama, llama.cpp, OpenAI, OpenRouter,
  or another OpenAI-compatible endpoint.

## Install From Source

```bash
bun install
```

## Install From NPM

Truss can be installed as a global npm CLI package after it is packed or
published. The npm package uses the existing Bun entrypoint, so Bun must be
installed and available on `PATH`.

Install from a local package tarball:

```bash
bun run build
npm pack
npm install -g ./truss-0.1.0.tgz
```

After installation:

```bash
truss spawn
truss spawn C:\path\to\workspace
```

## Windows Binary Package

Build a Windows x64 package from the Bun standalone executable:

```powershell
bun run package:windows
```

This writes `dist\windows\truss-windows-x64-0.1.0.zip`. Extract it, open a
PowerShell session in the extracted folder, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-truss.ps1
```

The Windows installer script installs Truss to
`%LOCALAPPDATA%\Programs\Truss`, adds `truss` to the current user's `Path`,
creates Start Menu entries, registers the tray helper for autostart, and starts
the tray helper for the current user. The tray starts the backend as the signed-in
Windows user, so Truss data lives under `%USERPROFILE%\.truss`.

The Start Menu `Truss` entry opens the main view. The tray icon can open the main
view, start/stop/restart Truss, and browse for a folder to open in a scoped
Truss instance.

To build an optional Inno Setup installer executable after installing Inno Setup:

```powershell
bun run package:windows:installer
```

If Inno Setup is installed outside the standard directories, pass
`-InnoSetupCompiler "C:\path\to\ISCC.exe"` to
`packaging\windows\build-package.ps1`.

## Run Locally

Start the app without opening a browser:

```bash
bun run start
```

Run in watch mode while developing:

```bash
bun run dev
```

Spawn Truss against a specific workspace:

```bash
bun run truss spawn C:\path\to\workspace --no-autolaunch
```

If no workspace path is provided, `truss spawn` uses the current working
directory for runtime context but shows conversations from all workspaces. Pass a
workspace path, including `.`, to scope conversation and agentic session history
to that directory only.

Useful flags:

```bash
bun run truss spawn . --no-autolaunch
bun run truss spawn . --no-open
bun run truss spawn . --port 17771
```

The `dev`, `start`, and `spawn:scoped` package scripts already use
`--no-autolaunch`, which keeps automated validation from opening repeated browser
tabs.

When no `--port` is provided, Truss tries `7805` first. If `7805` is already in
use, it falls back to a dynamic available port. `--port <number>` binds exactly
that port.

`--no-open` and `--no-autolaunch` are aliases. Both start the server without
opening the default browser.

## Validate

Run the static checks:

```bash
bun run check
```

Run the unit tests:

```bash
bun test
```

Build the frontend and backend bundle:

```bash
bun run build
```

For a complete local pass before a larger change, run all three:

```bash
bun run check
bun test
bun run build
```

## Web Tools Browser

The bundled Truss Web Tools MCP server uses an app-managed Camoufox browser for `web_search`, `load_webpage`, and `get_website_screenshot`. Truss downloads the pinned Camoufox release into the Truss home directory on first use and reuses it afterward. It also downloads uBlock Origin `1.71.0` from addons.mozilla.org by default, extracts the XPI into `~/.truss/camoufox-addons`, and loads that extracted add-on through Camoufox config. The browser is driven by a bundled JavaScript launcher child process; no Python Camoufox package is required.

Set `TRUSS_CAMOUFOX_EXECUTABLE` to use an existing Camoufox executable, `TRUSS_CAMOUFOX_INSTALL_DIR` to change the managed browser directory, `TRUSS_CAMOUFOX_NODE` to use a specific Node executable for the launcher child, `TRUSS_CAMOUFOX_DEFAULT_ADDONS=false` to skip the bundled default add-on, `TRUSS_CAMOUFOX_ADDON_URLS` to download additional comma-separated XPI or ZIP add-ons, `TRUSS_CAMOUFOX_ADDON_PATHS` to load extracted add-on directories, or `TRUSS_CAMOUFOX_HEADLESS=false` when you intentionally want to see the browser during debugging.

## Debugging

To debug the `load_webpage` tool or the `web_search` tool:

1. Run the dedicated debug script:
   ```bash
   bun run debug:truss-web-tools
   ```
2. Open the URL provided in the terminal (e.g., `https://debug.bun.sh/#...`) in Chrome, or attach your IDE's debugger to the listening port (default `6499`).
3. The server will start in "break on start" mode (`--inspect-brk`). Once you resume execution in the debugger, the MCP server will be ready to receive requests.

## Test Layout

Unit tests live under `tests/` and use Bun's built-in test runner.

- `tests/server/` covers backend helpers such as CLI parsing, LLM payload
  shaping, thinking extraction, and reasoning-budget enforcement.
- `tests/shared/` covers shared client/server contracts such as attachment
  classification and generated attachment names.

Keep tests close to pure contracts where possible. Route, storage, and provider
tests should use narrow fixtures and avoid browser autolaunch.

## Project Structure

```text
index.ts                      CLI package entrypoint
src/server/cli/               command parsing and startup behavior
src/server/http/              Bun HTTP server, API routes, and static serving
src/server/llm/               provider registry, payload shaping, streaming helpers
src/server/mcp/               MCP discovery, transports, config loading, and runtime
src/server/storage/           SQLite repositories and migrations
src/shared/protocol.ts        API, SSE, chat, provider, and settings contracts
src/client/                   React application, settings screens, chat UI, markdown
docs/                         architecture, settings, protocol, security, and schema docs
tests/                        Bun unit tests
```

Generated frontend assets are written to `public/assets/` by the build scripts.
Do not edit generated assets directly.

## Local Data

Truss writes local app state under the user's `.truss` directory:

- `truss.db`: SQLite database for provider settings, prompts, model profiles,
  history preferences, rich feature preferences, setup state, conversations,
  messages, and each conversation's workspace scope.
- `.env`: dotenvx-managed encrypted provider secrets.
- `.env.keys`: local dotenvx key material required to decrypt `.env`.
- `mcp.json`: global MCP server configuration managed by Truss.

The frontend receives sanitized configuration summaries only. Secret values are
write-only in the settings UI and are not returned by API responses.

## App Surfaces

- `/`: chat workspace.
- `/settings`: standalone settings route for providers, MCP, prompts, history,
  rich markdown features, customization, and system paths.
- `/api/session`: sanitized startup/session metadata.
- `/api/chat`: chat request and stream orchestration.

## Documentation

- `docs/software-architecture.md`
- `docs/protocol-contract.md`
- `docs/database-schema.md`
- `docs/settings.md`
- `docs/security.md`
- `docs/truss-flavored-markdown.md`
- `docs/initiatives/project-initiative-breakdown.md`
