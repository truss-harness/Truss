import type { SystemSettingsResponse } from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";

export function SystemPaths({ settings }: { settings: SystemSettingsResponse }) {
  const scoped = settings.conversationScopeMode === "workspace";

  return (
    <div className="grid gap-3">
      <PathRow
        description={
          scoped
            ? "Conversation and agentic session history is limited to this working directory."
            : "No working directory was specified, so Truss can access conversations from every workspace."
        }
        icon={scoped ? "folder_open" : "database"}
        label="Conversation scope"
        value={settings.conversationScopePath ?? "All conversations"}
      />
      <PathRow
        description="Directory Truss is running inside for MCP discovery, skills, and process working context."
        icon="folder_open"
        label="Working directory"
        value={
          scoped
              ? settings.workspacePath
              : "No workspace was specified."
        }
      />
      <PathRow
        description="SQLite database. Stores provider settings, model profiles, prompt templates, history preferences, setup customization, conversations, and each conversation's working directory scope. Provider API keys are not stored here."
        icon="database"
        label="Database"
        value={settings.databasePath}
      />
      <PathRow
        description="Local Truss data directory. Configuration files, and secrets live under this folder."
        icon="folder"
        label="Truss home"
        value={settings.trussHomeDir}
      />
      <PathRow
        description="Global MCP server configuration. Truss loads chat tools from the servers listed in this JSON file."
        icon="settings_ethernet"
        label="MCP config"
        value={settings.mcpConfigPath}
      />
      <PathRow
        description="Environment file for provider API keys. Secret values are written here encrypted and are never returned to the settings screen."
        icon="key"
        label="Encrypted secrets"
        value={settings.envPath}
      />
      <PathRow
        description="Private key needed to decrypt local secrets. Keep this file local and private."
        icon="vpn_key"
        label="Secret key material"
        value={settings.envKeysPath}
      />
    </div>
  );
}


function PathRow({
  description,
  icon,
  label,
  value,
}: {
  description: string;
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
        <span className="flex items-center gap-2 text-sm font-semibold text-on-surface">
          <MaterialIcon className="text-on-surface-variant" name={icon} size={18} />
          {label}
        </span>
        <code className="min-w-0 overflow-x-auto whitespace-nowrap text-xs text-on-surface-variant">
          {value}
        </code>
      </div>
      <p className="text-sm leading-6 text-on-surface-variant">{description}</p>
    </div>
  );
}

