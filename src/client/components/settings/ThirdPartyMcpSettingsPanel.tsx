import { useEffect, useRef, useState } from "react";
import type { LlmProviderSecretSummary } from "../../../shared/protocol.ts";
import { highlightCode } from "../../markdown.tsx";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";
import { JsonEditor } from "./SettingsJsonEditor.tsx";
import {
  PrimaryButton,
  SecondaryButton,
  SettingsAlert,
  SettingsTextInput,
} from "./SettingsControls.tsx";
import type { ThirdPartyMcpDraft } from "./types.ts";

const mcpConfigStdioExample = `{
  "mcpServers": {
    "local-files": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:/Users/you/Documents"
      ],
      "cwd": "C:/Users/you/Documents",
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}`;

const mcpConfigRemoteExample = `{
  "mcpServers": {
    "remote-search": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "auth": {
        "type": "api-key",
        "envVar": "TRUSS_MCP_SEARCH_API_KEY",
        "headerName": "Authorization",
        "prefix": "Bearer"
      }
    }
  }
}`;

const mcpConfigStdioEnvironmentExample = `{
  "mcpServers": {
    "local-search": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp-server.js"],
      "cwd": "C:/Users/you/tools/local-search",
      "env": {
        "SEARCH_REGION": "us-east-1",
        "LOG_LEVEL": "info"
      }
    }
  }
}`;

const mcpConfigOAuthClientCredentialsExample = `{
  "mcpServers": {
    "remote-crm": {
      "type": "streamable-http",
      "url": "https://crm.example.com/mcp",
      "auth": {
        "type": "oauth2-client-credentials",
        "tokenUrl": "https://crm.example.com/oauth/token",
        "clientIdEnv": "TRUSS_MCP_CRM_CLIENT_ID",
        "clientSecretEnv": "TRUSS_MCP_CRM_CLIENT_SECRET",
        "scope": "mcp.tools.read"
      }
    }
  }
}`;

const mcpConfigOAuthAuthorizationCodeExample = `{
  "mcpServers": {
    "remote-calendar": {
      "type": "streamable-http",
      "url": "https://calendar.example.com/mcp",
      "auth": {
        "type": "oauth2-authorization-code",
        "tokenUrl": "https://calendar.example.com/oauth/token",
        "clientIdEnv": "TRUSS_MCP_CALENDAR_CLIENT_ID",
        "clientSecretEnv": "TRUSS_MCP_CALENDAR_CLIENT_SECRET",
        "refreshTokenEnv": "TRUSS_MCP_CALENDAR_REFRESH_TOKEN",
        "scope": "calendar.read"
      }
    }
  }
}`;

const mcpConfigDisabledExample = `{
  "mcpServers": {
    "work-in-progress": {
      "disabled": true,
      "type": "stdio",
      "command": "node",
      "args": ["./server.js"]
    }
  }
}`;



export function ThirdPartyMcpSettingsPanel({
  draft,
  focusConfigRequest,
  mcpSecrets,
  onDraftChange,
  onRemoveCredential,
  onReload,
  onRestoreTrussDefault,
  onSave,
  onSaveCredential,
  reloading,
}: {
  draft: ThirdPartyMcpDraft;
  focusConfigRequest: number;
  mcpSecrets: LlmProviderSecretSummary[];
  onDraftChange(patch: Partial<ThirdPartyMcpDraft>): void;
  onRemoveCredential(envVar: string): void;
  onReload(): void;
  onRestoreTrussDefault(): void;
  onSave(): Promise<boolean>;
  onSaveCredential(): void;
  reloading: boolean;
}) {
  return (
    <div className="grid max-w-[900px] gap-4 pb-8">
      <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
        <div>
          <h3 className="text-lg font-semibold text-on-surface">External MCP servers</h3>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            3rd party MCP servers let Truss connect chat to tools exposed by other
            local programs or services. Global servers are loaded from this
            mcp.json file when you reload MCP servers.
          </p>
        </div>

        <div className="rounded-sm border border-outline-variant bg-surface px-3 py-3">
          <p className="text-sm font-semibold text-on-surface">
            Workspace MCP autodiscovery
          </p>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            When Truss is spawned with a workspace, it loads Claude Code, Codex,
            Cursor, GitHub Copilot, and Junie MCP servers for the running workspace
            only. Workspace discovered servers are not written to the global Truss
            {" "}
            <code>mcp.json</code>.
          </p>
        </div>
      </article>

      <McpCredentialsCard
        draft={draft}
        mcpSecrets={mcpSecrets}
        onDraftChange={onDraftChange}
        onRemoveCredential={onRemoveCredential}
        onSaveCredential={onSaveCredential}
      />

      <McpConfigEditor
        configPath={draft.mcpConfigPath}
        error={draft.error}
        focusRequest={focusConfigRequest}
        onChange={(configText) => onDraftChange({ configText })}
        onReloadMcpServers={onReload}
        onRestoreTrussDefault={onRestoreTrussDefault}
        onSave={onSave}
        reloading={reloading}
        saving={draft.saving}
        value={draft.configText}
      />
    </div>
  );
}



function McpCredentialsCard({
  draft,
  mcpSecrets,
  onDraftChange,
  onRemoveCredential,
  onSaveCredential,
}: {
  draft: ThirdPartyMcpDraft;
  mcpSecrets: LlmProviderSecretSummary[];
  onDraftChange(patch: Partial<ThirdPartyMcpDraft>): void;
  onRemoveCredential(envVar: string): void;
  onSaveCredential(): void;
}) {
  return (
    <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
      <div>
        <h3 className="text-lg font-semibold text-on-surface">MCP credentials</h3>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          Store remote MCP credentials in the encrypted Truss dotenvx file, then
          reference them from <code>mcp.json</code> by environment variable name.
          Use names that start with <code>TRUSS_MCP_</code>.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto]">
        <SettingsTextInput
          helpText="Example: TRUSS_MCP_SEARCH_API_KEY"
          label="Secret env var"
          mono
          onChange={(credentialEnvVar) => onDraftChange({ credentialEnvVar })}
          placeholder="TRUSS_MCP_SERVICE_API_KEY"
          value={draft.credentialEnvVar}
        />
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Secret value
          </span>
          <input
            className="h-10 w-full rounded-sm border border-outline-variant bg-surface-container-low px-3 font-mono text-xs text-on-surface outline-none transition focus:border-outline focus:bg-surface"
            onChange={(event) => onDraftChange({ credentialValue: event.target.value })}
            placeholder="Paste a new credential value"
            type="password"
            value={draft.credentialValue}
          />
          <span className="text-xs leading-5 text-on-surface-variant">
            Existing values are never returned for display.
          </span>
        </label>
        <div className="flex items-start lg:pt-6">
          <PrimaryButton
            disabled={draft.saving}
            icon="vpn_key"
            label={draft.saving ? "Saving" : "Save credential"}
            onClick={onSaveCredential}
          />
        </div>
      </div>

      {mcpSecrets.length > 0 ? (
        <div className="grid gap-2">
          <div className="grid gap-1">
            <p className="text-xs font-semibold uppercase text-on-surface-variant">
              Stored MCP credential variables
            </p>
            <p className="text-xs leading-5 text-on-surface-variant">
              Saving a secret credential with the same variable name overwrites the
              existing stored value.
            </p>
          </div>
          <div className="grid gap-2">
            {mcpSecrets.map((secret) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-outline-variant bg-surface px-3 py-2"
                key={secret.envVar}
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-on-surface">
                    {secret.envVar}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {secret.configured
                      ? `${secret.source}${secret.encrypted ? " encrypted" : ""}`
                      : "missing"}
                  </p>
                </div>
                <button
                  className="h-9 shrink-0 rounded-sm border border-outline-variant px-3 text-xs font-semibold text-on-surface-variant transition hover:border-error hover:text-error focus:border-error focus:text-error focus:outline-none"
                  disabled={draft.saving}
                  onClick={() => onRemoveCredential(secret.envVar)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}



function McpConfigEditor({
  configPath,
  error,
  focusRequest,
  onChange,
  onReloadMcpServers,
  onRestoreTrussDefault,
  onSave,
  reloading,
  saving,
  value,
}: {
  configPath: string;
  error: string | null;
  focusRequest: number;
  onChange(value: string): void;
  onReloadMcpServers(): void;
  onRestoreTrussDefault(): void;
  onSave(): Promise<boolean>;
  reloading: boolean;
  saving: boolean;
  value: string;
}) {
  const [schemaHelpOpen, setSchemaHelpOpen] = useState(false);
  const [expandedEditorOpen, setExpandedEditorOpen] = useState(false);
  const editorCardRef = useRef<HTMLElement | null>(null);
  const handledFocusRequestRef = useRef(0);

  useEffect(() => {
    if (focusRequest <= 0 || handledFocusRequestRef.current === focusRequest) {
      return;
    }

    handledFocusRequestRef.current = focusRequest;
    editorCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setExpandedEditorOpen(true);
  }, [focusRequest]);

  async function saveInlineEditor(): Promise<void> {
    await onSave();
  }

  async function saveExpandedEditor(): Promise<void> {
    const saved = await onSave();

    if (saved) {
      setExpandedEditorOpen(false);
    }
  }

  return (
    <article
      className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]"
      ref={editorCardRef}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-on-surface">Global Truss MCP config</h3>
          {configPath ? (
            <code className="mt-2 block overflow-x-auto whitespace-nowrap text-xs text-on-surface-variant">
              {configPath}
            </code>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <SecondaryButton
            disabled={saving}
            icon="restart_alt"
            label="Restore Truss MCP"
            onClick={onRestoreTrussDefault}
          />
          <SecondaryButton
            disabled={saving || reloading}
            icon="sync"
            label={reloading ? "Reloading" : "Reload MCP servers"}
            onClick={onReloadMcpServers}
          />
          <button
            aria-label="Open mcp.json schema help"
            className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none"
            onClick={() => setSchemaHelpOpen(true)}
            title="mcp.json schema help"
            type="button"
          >
            <MaterialIcon name="help" size={20} />
          </button>
        </div>
      </div>
      <JsonEditor
        ariaLabel="mcp.json editor"
        onChange={onChange}
        onFocus={() => setExpandedEditorOpen(true)}
        value={value}
      />
      <p className="text-xs leading-5 text-on-surface-variant">
        Saving validates JSON and refreshes Truss-managed defaults in the global MCP
        configuration file. Reload MCP servers reconnects the current saved config
        without restarting Truss.
      </p>
      {error ? <SettingsAlert tone="error" message={error} /> : null}
      <div className="flex justify-end">
        <PrimaryButton
          disabled={saving}
          icon="save"
          label={saving ? "Saving" : "Save mcp.json"}
          onClick={() => void saveInlineEditor()}
        />
      </div>
      <Modal
        bodyClassName="truss-mcp-config-modal-body"
        className="truss-mcp-config-modal"
        description={configPath || "Global MCP server configuration loaded by Truss."}
        footer={
          <>
            <SecondaryButton
              disabled={saving || reloading}
              icon="sync"
              label={reloading ? "Reloading" : "Reload MCP servers"}
              onClick={onReloadMcpServers}
            />
            <SecondaryButton
              icon="close"
              label="Close editor"
              onClick={() => setExpandedEditorOpen(false)}
            />
            <PrimaryButton
              disabled={saving}
              icon="save"
              label={saving ? "Saving" : "Save mcp.json"}
              onClick={() => void saveExpandedEditor()}
            />
          </>
        }
        headerActions={
          <button
            aria-label="Open mcp.json schema help"
            className="truss-modal-header-button"
            onClick={() => setSchemaHelpOpen(true)}
            title="mcp.json schema help"
            type="button"
          >
            <MaterialIcon name="help" size={18} />
          </button>
        }
        icon="settings_ethernet"
        onClose={() => setExpandedEditorOpen(false)}
        open={expandedEditorOpen}
        restoreFocus={false}
        size="xl"
        title="Global Truss MCP config"
      >
        <div className="truss-mcp-config-editor-shell">
          <JsonEditor
            ariaLabel="Expanded mcp.json editor"
            autoFocus
            className="truss-json-editor-fill"
            onChange={onChange}
            showLineNumbers
            value={value}
          />
          {error ? <SettingsAlert tone="error" message={error} /> : null}
        </div>
      </Modal>
      <McpConfigSchemaHelpModal
        onClose={() => setSchemaHelpOpen(false)}
        open={schemaHelpOpen}
      />
    </article>
  );
}



function McpConfigSchemaHelpModal({
  onClose,
  open,
}: {
  onClose(): void;
  open: boolean;
}) {
  return (
    <Modal
      description="The global MCP server configuration loaded by Truss."
      footer={<SecondaryButton icon="close" label="Close" onClick={onClose} />}
      icon="help"
      onClose={onClose}
      open={open}
      size="lg"
      title="mcp.json schema"
    >
      <div className="grid gap-5 pb-4 text-sm leading-6 text-on-surface-variant">
        <div className="rounded-sm border border-error/40 bg-error-container px-3 py-3 text-error">
          <div className="flex gap-2">
            <MaterialIcon name="warning" size={18} />
            <p>
              Do not hand-edit <code>truss-web-tools</code>,{" "}
              <code>truss-chat-tools</code>, <code>truss-filesystem-tools</code>, or{" "}
              <code>truss-orchestration-tools</code> while they have{" "}
              <code>"_trussManaged": true</code>. Truss rewrites those entries with
              the current command, working directory, <code>--truss-home</code>{" "}
              path, and scoped <code>--workspace-path</code> values when a
              working directory was specified. The filesystem entry is disabled
              outside scoped workspace launches because first-party filesystem
              access is off by default in global mode until a directory is granted
              for the global context. Use{" "}
              <strong>Restore Truss MCP</strong> if a managed entry is missing or
              broken.
            </p>
          </div>
        </div>

        <section className="grid gap-2">
          <h4 className="text-sm font-semibold text-on-surface">Top-level shape</h4>
          <p>
            The recommended shape is a JSON object with a top-level{" "}
            <code>mcpServers</code> object. This is the Claude-style MCP config shape
            that Truss writes for its own global config. Each key inside{" "}
            <code>mcpServers</code> is a stable server ID, and each value is that
            server's launch definition.
          </p>
          <p>
            Truss can also read <code>servers</code> for compatibility, but this
            editor manages <code>mcpServers</code>. Prefer <code>mcpServers</code>
            and avoid mixing both keys in the same file.
          </p>
        </section>

        <section className="grid gap-3">
          <h4 className="text-sm font-semibold text-on-surface">Server fields</h4>
          <ul className="grid gap-2">
            <li>
              <code>type</code> or <code>transport</code>: optional transport name.
              Supported values are <code>stdio</code>, <code>http-sse</code>, and{" "}
              <code>streamable-http</code>. If omitted, Truss infers <code>stdio</code>
              from <code>command</code> or a remote transport from <code>url</code>.
            </li>
            <li>
              <code>command</code>: executable path for local stdio servers. Use an
              absolute path when the executable is not reliably on the Truss process
              PATH.
            </li>
            <li>
              <code>args</code>: string array of command-line arguments passed after
              the command. Non-string values are ignored by Truss.
            </li>
            <li>
              <code>cwd</code>: optional working directory for stdio servers. This is
              passed to the spawned process as its current directory.
            </li>
            <li>
              <code>env</code>: optional object of string environment variables.
              Truss merges these values over its own process environment before
              spawning the MCP server.
            </li>
            <li>
              <code>url</code>: endpoint for remote MCP transports. Authenticated
              remote servers should also include an <code>auth</code> block that
              references values from the encrypted Truss secret store.
            </li>
            <li>
              <code>name</code>: optional display name. If omitted, Truss uses the
              server ID from the <code>mcpServers</code> key.
            </li>
            <li>
              <code>disabled</code>: set to <code>true</code> to keep a server in the
              file while preventing Truss from connecting it.
            </li>
          </ul>
        </section>

        <section className="grid gap-2">
          <h4 className="text-sm font-semibold text-on-surface">Environment variables</h4>
          <p>
            For local stdio servers, add non-secret values in <code>env</code>.
            Stored <code>TRUSS_MCP_*</code> credentials are already available to
            launched MCP servers by that exact variable name, so no extra{" "}
            <code>env</code> entry is needed when the server reads the same name.
          </p>
          <p>
            For remote servers, reference stored credentials in <code>auth</code>{" "}
            fields such as <code>envVar</code>, <code>clientIdEnv</code>,{" "}
            <code>clientSecretEnv</code>, <code>accessTokenEnv</code>, or{" "}
            <code>refreshTokenEnv</code>.
          </p>
        </section>

        <section className="grid gap-3">
          <h4 className="text-sm font-semibold text-on-surface">Authentication</h4>
          <p>
            Do not paste API keys, client secrets, access tokens, or refresh tokens
            directly into <code>mcp.json</code>. Add them as <code>TRUSS_MCP_*</code>
            credentials in the MCP credentials card. Truss writes those values to the
            local dotenvx-encrypted secret file and returns only configured/missing
            status to the UI.
          </p>
          <ul className="grid gap-2">
            <li>
              <code>api-key</code>: reads one secret env var and sends it as a header.
              Defaults to <code>Authorization: Bearer &lt;value&gt;</code>, but you can
              set <code>headerName</code> and <code>prefix</code> for services that use
              headers such as <code>X-API-Key</code>.
            </li>
            <li>
              <code>oauth2-client-credentials</code>: reads <code>clientIdEnv</code>{" "}
              and <code>clientSecretEnv</code>, requests an access token from{" "}
              <code>tokenUrl</code> with the client credentials grant, caches it until
              expiry, then sends it as the <code>Authorization</code> header.
            </li>
            <li>
              <code>oauth2-authorization-code</code>: uses an already stored{" "}
              <code>accessTokenEnv</code>, or exchanges <code>refreshTokenEnv</code>{" "}
              at <code>tokenUrl</code> for a fresh access token. Truss does not launch
              the browser consent screen here; complete the provider authorization
              once, store the resulting token material as <code>TRUSS_MCP_*</code>{" "}
              secrets, and reference those names in the auth block.
            </li>
          </ul>
        </section>

        <section className="grid gap-2">
          <h4 className="text-sm font-semibold text-on-surface">Operational notes</h4>
          <p>
            Saving validates JSON syntax and refreshes Truss-managed defaults. Use
            Reload MCP servers after adding, removing, or changing external servers.
          </p>
          <p>
            Unknown fields are preserved in the file, but Truss only uses the fields
            listed above when it normalizes server definitions.
          </p>
        </section>

        <section className="grid gap-3">
          <h4 className="text-sm font-semibold text-on-surface">Examples</h4>
          <McpSchemaCodeBlock code={mcpConfigStdioExample} label="Local stdio server" />
          <McpSchemaCodeBlock
            code={mcpConfigStdioEnvironmentExample}
            label="Stdio environment variables"
          />
          <McpSchemaCodeBlock code={mcpConfigRemoteExample} label="Remote API key" />
          <McpSchemaCodeBlock
            code={mcpConfigOAuthClientCredentialsExample}
            label="OAuth2 client credentials"
          />
          <McpSchemaCodeBlock
            code={mcpConfigOAuthAuthorizationCodeExample}
            label="OAuth2 authorization code"
          />
          <McpSchemaCodeBlock code={mcpConfigDisabledExample} label="Disabled server" />
        </section>
      </div>
    </Modal>
  );
}



function McpSchemaCodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-outline-variant bg-inverse-surface text-inverse-on-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase text-inverse-on-surface/65">
        {label}
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-5">
        <code className="language-json">{highlightCode(code, "json")}</code>
      </pre>
    </div>
  );
}


