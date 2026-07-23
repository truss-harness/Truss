import type {
  CommandRunnerSettingsSummary,
  PlaywrightMcpSettingsSummary,
} from "../../../shared/protocol.ts";
import type { SettingsTabId } from "./types.ts";

export const toastDismissDelayMs = 2400;

export const defaultCommandRunnerSettings: CommandRunnerSettingsSummary = {
  dangerousAction: "ask",
  guardModelId: null,
  guardProviderId: null,
  postExecutionGuardEnabled: true,
  preExecutionGuardEnabled: true,
  riskyAction: "ask",
  safeAction: "auto-allow",
};

export const defaultPlaywrightMcpSettings: PlaywrightMcpSettingsSummary = {
  enabled: false,
  tools: "*",
};

export const settingsTabs: Array<{
  description: string;
  group: "General" | "MCP" | "Processes";
  icon: string;
  id: SettingsTabId;
  label: string;
}> = [
  {
    description: "Provider configuration and key rotation",
    group: "General",
    icon: "hub",
    id: "connections",
    label: "Connections",
  },
  {
    description: "Optional personalization for prompt templates",
    group: "General",
    icon: "tune",
    id: "customization",
    label: "Customization",
  },
  {
    description: "Discovered MCP servers, tools, resources, and prompts",
    group: "MCP",
    icon: "construction",
    id: "mcp-servers",
    label: "MCP Status",
  },
  {
    description: "First-party Truss MCP servers and guard model settings",
    group: "MCP",
    icon: "travel_explore",
    id: "truss-mcp",
    label: "Built-in MCP servers",
  },
  {
    description: "External MCP servers and global mcp.json editing",
    group: "MCP",
    icon: "settings_ethernet",
    id: "third-party-mcp",
    label: "Additional MCP servers",
  },
  {
    description: "Conversation and agentic mode model instructions",
    group: "General",
    icon: "terminal",
    id: "system-prompts",
    label: "System prompts",
  },
  {
    description: "Reasoning budget and context replay controls",
    group: "General",
    icon: "psychology",
    id: "history",
    label: "AI behaviour",
  },
  {
    description: "Interactive markdown rendering and prompt hints",
    group: "General",
    icon: "auto_awesome",
    id: "rich-features",
    label: "Rich features",
  },
  {
    description: "Local Truss storage paths",
    group: "General",
    icon: "dns",
    id: "system",
    label: "System",
  },
  {
    description: "Active local Truss servers and their idle expiry",
    group: "Processes",
    icon: "memory",
    id: "processes",
    label: "Processes",
  },
];

export const settingsTabGroups: Array<{
  label: "General" | "MCP" | "Processes";
  tabs: typeof settingsTabs;
}> = [
  { label: "General", tabs: settingsTabs.filter((tab) => tab.group === "General") },
  { label: "MCP", tabs: settingsTabs.filter((tab) => tab.group === "MCP") },
  { label: "Processes", tabs: settingsTabs.filter((tab) => tab.group === "Processes") },
];

export const personalizationIntro =
  "Setting a nickname, location, and response language is optional. If set, Truss uses them as prompt customization when replying to you; they are not required and do not create an account anywhere.";

export const preferredLanguageHelp =
  "This sets the preferred language for AI responses only. It does not change the Truss interface language, and response quality depends on what the selected AI model can reliably understand and write.";

export const locationHelp =
  "Optional, for location-aware replies. If you do not want that, leave it empty.";

export const locationAutofillTooltip =
  "Makes the Truss backend send an unsecured HTTP request to http://ip-api.com/json/ to estimate your city, region, and country.";

export function initialSettingsTab(): SettingsTabId {
  const tab = new URLSearchParams(window.location.search).get("tab");

  return isSettingsTabId(tab) ? tab : "connections";
}

function isSettingsTabId(value: string | null): value is SettingsTabId {
  return settingsTabs.some((tab) => tab.id === value);
}
