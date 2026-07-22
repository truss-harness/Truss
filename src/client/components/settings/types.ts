import type {
  CommandRunnerSettingsSummary,
  PlaywrightMcpSettingsSummary,
} from "../../../shared/protocol.ts";
import type { ModelSelectorOption } from "../ModelSelector.tsx";

export interface ProviderDraft {
  baseUrl: string;
  clearSecrets: Record<string, boolean>;
  defaultModel: string;
  enabled: boolean;
  error: string | null;
  saving: boolean;
  secretValues: Record<string, string>;
}

export interface CustomizationDraft {
  location: string;
  nickname: string;
  preferredLanguage: string;
}

export interface PromptDraft {
  error: string | null;
  saving: boolean;
  template: string;
}

export interface TrussMcpDraft {
  commandRunner: CommandRunnerSettingsSummary;
  error: string | null;
  playwrightMcp: PlaywrightMcpSettingsSummary;
  sanitizerModelId: string | null;
  sanitizerProviderId: string | null;
  saving: boolean;
}

export interface ThirdPartyMcpDraft {
  configText: string;
  credentialEnvVar: string;
  credentialValue: string;
  error: string | null;
  mcpConfigPath: string;
  saving: boolean;
}

export interface ProviderModelList {
  models: string[];
  source: ModelSelectorOption["source"];
}

export interface ToastState {
  id: string;
  message: string;
}

export type SettingsTabId =
  | "connections"
  | "customization"
  | "mcp-servers"
  | "truss-mcp"
  | "third-party-mcp"
  | "system-prompts"
  | "history"
  | "rich-features"
  | "system"
  | "processes";
