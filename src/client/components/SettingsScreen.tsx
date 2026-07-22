import { useEffect, useRef, useState } from "react";
import type {
  FileAccessDirectorySummary,
  FileAccessSecurityResponse,
  FilesystemGrantsUpdatedEvent,
  FirstRunSetupSummary,
  HistorySettingsSummary,
  LlmModelProfileSummary,
  LlmProviderSecretSummary,
  LlmProviderSettingsUpdateRequest,
  LlmProviderSummary,
  McpCapabilitiesEvent,
  McpDiscoverySummary,
  McpSettingsSummary,
  RichFeatureSettingsSummary,
  RichFeatureSettingsUpdateRequest,
  SystemReadyEvent,
  SystemPromptMode,
  SystemPromptPlaceholderSummary,
  SystemPromptTemplateSummary,
  SystemSettingsResponse,
} from "../../shared/protocol.ts";
import {
  fetchFileAccessSettings,
  fetchSession,
  fetchHistorySettings,
  fetchLlmProviderSettings,
  fetchLlmProviderModels,
  fetchModelProfiles,
  fetchMcpSettings,
  fetchRichFeatureSettings,
  fetchSetup,
  fetchSetupLocation,
  fetchSystemPromptSettings,
  fetchSystemSettings,
  reloadMcpServers,
  updateHistorySettings,
  updateLlmProviderSettings,
  updateMcpSettings,
  updateFileAccessSettings,
  updateRichFeatureSettings,
  updateSetup,
  updateSystemPromptSettings,
  pickWorkspaceDirectory,
} from "../api.ts";
import { defaultRichFeatureSettings } from "../rich-features.ts";
import { errorMessage } from "./chat/chat-utils.ts";
import { MaterialIcon } from "./MaterialIcon.tsx";
import {
  defaultCommandRunnerSettings,
  defaultPlaywrightMcpSettings,
  initialSettingsTab,
  locationAutofillTooltip,
  locationHelp,
  personalizationIntro,
  preferredLanguageHelp,
  settingsTabGroups,
  toastDismissDelayMs,
} from "./settings/config.ts";
import { HistoryToggleCard } from "./settings/HistorySettings.tsx";
import {
  fileAccessDirectoryUpdate,
  McpServersSettingsPanel,
  shouldRequestExternalStdioApproval,
  ThirdPartyMcpSettingsPanel,
  TrussMcpSettingsPanel,
} from "./settings/McpSettingsPanels.tsx";
import {
  buildSanitizerModelOptions,
  configuredProvider,
  providerModelFallbacks,
  providerToDraft,
} from "./settings/model-options.ts";
import { PromptEditor, promptLabel } from "./settings/PromptEditor.tsx";
import { ProviderSettingsPanel } from "./settings/ProviderSettingsPanel.tsx";
import { RichFeaturesPanel } from "./settings/RichFeaturesPanel.tsx";
import {
  normalizeIntegerInput,
  PrimaryButton,
  SettingsAlert,
  SettingsNumberInput,
  SettingsSection,
  SettingsSwitch,
  SettingsTextInput,
  ToastNotification,
} from "./settings/SettingsControls.tsx";
import { SystemPaths } from "./settings/SystemPaths.tsx";
import { SpawnedProcessesPanel } from "./settings/SpawnedProcessesPanel.tsx";
import type {
  CustomizationDraft,
  PromptDraft,
  ProviderDraft,
  ProviderModelList,
  SettingsTabId,
  ThirdPartyMcpDraft,
  ToastState,
  TrussMcpDraft,
} from "./settings/types.ts";

export function SettingsScreen() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialSettingsTab());
  const [providers, setProviders] = useState<LlmProviderSummary[]>([]);
  const [modelProfiles, setModelProfiles] = useState<LlmModelProfileSummary[]>([]);
  const [sanitizerProviderModels, setSanitizerProviderModels] = useState<
    Record<string, ProviderModelList>
  >({});
  const [sanitizerModelsLoading, setSanitizerModelsLoading] = useState(false);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [setup, setSetup] = useState<FirstRunSetupSummary | null>(null);
  const [customizationDraft, setCustomizationDraft] = useState<CustomizationDraft>({
    location: "",
    nickname: "",
    preferredLanguage: "",
  });
  const [customizationSaving, setCustomizationSaving] = useState(false);
  const [customizationError, setCustomizationError] = useState<string | null>(null);
  const [viewCustomizationSaving, setViewCustomizationSaving] = useState(false);
  const [viewCustomizationError, setViewCustomizationError] = useState<string | null>(null);
  const [locationDetecting, setLocationDetecting] = useState(false);
  const [historySettings, setHistorySettings] = useState<HistorySettingsSummary | null>(null);
  const [historyDraft, setHistoryDraft] = useState({
    includeThinkingHistory: false,
    includeToolHistory: false,
    limitReasoningBudget: false,
    maxReasoningTimeSeconds: 300,
    maxReasoningWords: 10000,
  });
  const [historySaving, setHistorySaving] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [richFeatureSettings, setRichFeatureSettings] =
    useState<RichFeatureSettingsSummary>(defaultRichFeatureSettings);
  const [richFeatureDraft, setRichFeatureDraft] =
    useState<RichFeatureSettingsSummary>(defaultRichFeatureSettings);
  const [richFeatureSaving, setRichFeatureSaving] = useState(false);
  const [richFeatureError, setRichFeatureError] = useState<string | null>(null);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsSummary>({
    commandRunner: defaultCommandRunnerSettings,
    playwrightMcp: defaultPlaywrightMcpSettings,
    sanitizerModelId: null,
    sanitizerProviderId: null,
  });
  const [mcpDiscovery, setMcpDiscovery] = useState<McpDiscoverySummary | null>(null);
  const [mcpDiscoveryLoading, setMcpDiscoveryLoading] = useState(true);
  const [mcpDiscoveryError, setMcpDiscoveryError] = useState<string | null>(null);
  const [mcpApprovingStdioServers, setMcpApprovingStdioServers] = useState(false);
  const [mcpReloading, setMcpReloading] = useState(false);
  const [fileAccessSettings, setFileAccessSettings] =
    useState<FileAccessSecurityResponse | null>(null);
  const [fileAccessLoading, setFileAccessLoading] = useState(true);
  const [fileAccessError, setFileAccessError] = useState<string | null>(null);
  const [revokingFileAccessGrantId, setRevokingFileAccessGrantId] = useState<number | null>(null);
  const [mcpSecrets, setMcpSecrets] = useState<LlmProviderSecretSummary[]>([]);
  const [trussMcpDraft, setTrussMcpDraft] = useState<TrussMcpDraft>({
    commandRunner: defaultCommandRunnerSettings,
    error: null,
    playwrightMcp: defaultPlaywrightMcpSettings,
    sanitizerModelId: null,
    sanitizerProviderId: null,
    saving: false,
  });
  const [thirdPartyMcpDraft, setThirdPartyMcpDraft] = useState<ThirdPartyMcpDraft>({
    configText: "",
    credentialEnvVar: "TRUSS_MCP_",
    credentialValue: "",
    error: null,
    mcpConfigPath: "",
    saving: false,
  });
  const [promptSettings, setPromptSettings] = useState<{
    placeholders: SystemPromptPlaceholderSummary[];
    prompts: SystemPromptTemplateSummary[];
  }>({ placeholders: [], prompts: [] });
  const [promptDrafts, setPromptDrafts] = useState<Record<SystemPromptMode, PromptDraft>>({
    agentic: { error: null, saving: false, template: "" },
    conversation: { error: null, saving: false, template: "" },
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [mcpConfigFocusRequest, setMcpConfigFocusRequest] = useState(0);
  const toastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    void loadSettings();
    void loadMcpDiscovery();

    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");

    const handleMcpEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as McpCapabilitiesEvent;

      setMcpDiscovery(event.mcp);
      setMcpDiscoveryError(null);
      setMcpDiscoveryLoading(false);
    };

    const handleReadyEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SystemReadyEvent;

      setMcpDiscovery(event.session.mcp);
      setMcpDiscoveryError(null);
      setMcpDiscoveryLoading(false);
    };

    const handleFileAccessEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as FilesystemGrantsUpdatedEvent;

      setFileAccessSettings(event.fileAccess);
      setFileAccessError(null);
      setFileAccessLoading(false);
    };

    source.addEventListener("mcp.capabilities", handleMcpEvent);
    source.addEventListener("system.ready", handleReadyEvent);
    source.addEventListener("filesystem.grants.updated", handleFileAccessEvent);

    return () => {
      source.removeEventListener("mcp.capabilities", handleMcpEvent);
      source.removeEventListener("system.ready", handleReadyEvent);
      source.removeEventListener("filesystem.grants.updated", handleFileAccessEvent);
      source.close();
    };
  }, []);

  useEffect(() => {
    setProviderDrafts((current) => {
      const next = { ...current };

      for (const provider of providers) {
        if (next[provider.id]?.saving) {
          continue;
        }

        next[provider.id] = providerToDraft(provider);
      }

      return next;
    });
  }, [providers]);

  useEffect(() => {
    let cancelled = false;

    async function loadSanitizerModels(): Promise<void> {
      const configuredProviders = providers.filter(configuredProvider);
      const fallbackLists = Object.fromEntries(
        configuredProviders.map((provider) => [
          provider.id,
          {
            models: providerModelFallbacks(provider),
            source: "configured" as const,
          },
        ]),
      );

      setSanitizerProviderModels(fallbackLists);

      if (configuredProviders.length === 0) {
        setSanitizerModelsLoading(false);
        return;
      }

      setSanitizerModelsLoading(true);

      try {
        const fetchedLists = await Promise.all(
          configuredProviders.map(async (provider) => {
            try {
              const response = await fetchLlmProviderModels(provider.id, {
                apiKey: null,
                baseUrl: null,
              });

              return [
                provider.id,
                {
                  models: response.models,
                  source: "endpoint" as const,
                },
              ] as const;
            } catch {
              return [
                provider.id,
                {
                  models: providerModelFallbacks(provider),
                  source: "configured" as const,
                },
              ] as const;
            }
          }),
        );

        if (!cancelled) {
          setSanitizerProviderModels(Object.fromEntries(fetchedLists));
        }
      } finally {
        if (!cancelled) {
          setSanitizerModelsLoading(false);
        }
      }
    }

    void loadSanitizerModels();

    return () => {
      cancelled = true;
    };
  }, [providers]);

  useEffect(() => {
    if (!setup) {
      return;
    }

    setCustomizationDraft({
      location: setup.location ?? "",
      nickname: setup.nickname ?? "",
      preferredLanguage: setup.preferredLanguage ?? "",
    });
  }, [setup]);

  useEffect(() => {
    if (!historySettings) {
      return;
    }

    setHistoryDraft({
      includeThinkingHistory: historySettings.includeThinkingHistory,
      includeToolHistory: historySettings.includeToolHistory,
      limitReasoningBudget: historySettings.limitReasoningBudget,
      maxReasoningTimeSeconds: historySettings.maxReasoningTimeSeconds,
      maxReasoningWords: historySettings.maxReasoningWords,
    });
  }, [historySettings]);

  useEffect(() => {
    setTrussMcpDraft((current) => {
      if (current.saving) {
        return current;
      }

      return {
        commandRunner: mcpSettings.commandRunner,
        error: null,
        playwrightMcp: mcpSettings.playwrightMcp ?? defaultPlaywrightMcpSettings,
        sanitizerModelId: mcpSettings.sanitizerModelId,
        sanitizerProviderId: mcpSettings.sanitizerProviderId,
        saving: false,
      };
    });
  }, [mcpSettings]);

  useEffect(() => {
    setPromptDrafts((current) => {
      const next = { ...current };

      for (const prompt of promptSettings.prompts) {
        if (next[prompt.mode]?.saving) {
          continue;
        }

        next[prompt.mode] = {
          error: null,
          saving: false,
          template: prompt.template,
        };
      }

      return next;
    });
  }, [promptSettings.prompts]);

  async function loadSettings(): Promise<void> {
    setLoading(true);
    setPageError(null);
    setFileAccessLoading(true);

    try {
      const [
        providerResponse,
        setupResponse,
        historyResponse,
        richFeatureResponse,
        mcpResponse,
        fileAccessResponse,
        promptsResponse,
        systemResponse,
        modelProfilesResponse,
      ] =
        await Promise.all([
          fetchLlmProviderSettings(),
          fetchSetup(),
          fetchHistorySettings(),
          fetchRichFeatureSettings(),
          fetchMcpSettings(),
          fetchFileAccessSettings(),
          fetchSystemPromptSettings(),
          fetchSystemSettings(),
          fetchModelProfiles(),
        ]);

      setProviders(providerResponse.providers);
      setModelProfiles(modelProfilesResponse.profiles);
      setSetup(setupResponse.setup);
      setHistorySettings(historyResponse.history);
      setRichFeatureSettings(richFeatureResponse.richFeatures);
      setRichFeatureDraft(richFeatureResponse.richFeatures);
      setMcpSettings(mcpResponse.settings);
      setFileAccessSettings(fileAccessResponse);
      setFileAccessError(null);
      setFileAccessLoading(false);
      setMcpSecrets(mcpResponse.secrets);
      setThirdPartyMcpDraft((current) => ({
        ...current,
        configText: mcpResponse.mcpConfigText,
        error: null,
        mcpConfigPath: mcpResponse.mcpConfigPath,
        saving: false,
      }));
      setPromptSettings(promptsResponse);
      setSystemSettings(systemResponse);
    } catch (caught) {
      setPageError(errorMessage(caught));
      setFileAccessLoading(false);
    } finally {
      setLoading(false);
    }
  }

  async function loadMcpDiscovery(): Promise<void> {
    setMcpDiscoveryLoading(true);
    setMcpDiscoveryError(null);

    try {
      const session = await fetchSession();

      setMcpDiscovery(session.mcp);
    } catch (caught) {
      setMcpDiscoveryError(errorMessage(caught));
    } finally {
      setMcpDiscoveryLoading(false);
    }
  }

  async function loadFileAccessSettings(): Promise<void> {
    setFileAccessLoading(true);
    setFileAccessError(null);

    try {
      setFileAccessSettings(await fetchFileAccessSettings());
    } catch (caught) {
      setFileAccessError(errorMessage(caught));
    } finally {
      setFileAccessLoading(false);
    }
  }

  async function reloadMcpServersFromSettings(): Promise<void> {
    const approveStdioServers = shouldRequestExternalStdioApproval(
      thirdPartyMcpDraft.configText,
    );

    if (
      approveStdioServers &&
      !window.confirm(
        "Reloading MCP servers can start external local commands from mcp.json. Approve the active external stdio server commands before reloading?",
      )
    ) {
      return;
    }

    setMcpReloading(true);
    setMcpDiscoveryLoading(true);
    setMcpDiscoveryError(null);
    setThirdPartyMcpDraft((current) => ({ ...current, error: null }));

    try {
      const response = await reloadMcpServers(
        approveStdioServers ? { approveStdioServers: true } : {},
      );

      setMcpDiscovery(response.mcp);
      showToast("MCP servers reloaded.");
    } catch (caught) {
      const message = errorMessage(caught);

      setMcpDiscoveryError(message);
      setThirdPartyMcpDraft((current) => ({ ...current, error: message }));
    } finally {
      setMcpReloading(false);
      setMcpDiscoveryLoading(false);
    }
  }

  async function approveCurrentMcpStdioServersFromSettings(): Promise<void> {
    if (
      !window.confirm(
        "Approving allows Truss to spawn active external stdio commands from mcp.json. Approve and reload MCP servers?",
      )
    ) {
      return;
    }

    setMcpApprovingStdioServers(true);
    setMcpReloading(true);
    setMcpDiscoveryLoading(true);
    setMcpDiscoveryError(null);
    setThirdPartyMcpDraft((current) => ({ ...current, error: null }));

    try {
      const response = await reloadMcpServers({ approveStdioServers: true });

      setMcpDiscovery(response.mcp);
      showToast("MCP stdio commands approved and servers reloaded.");
    } catch (caught) {
      const message = errorMessage(caught);

      setMcpDiscoveryError(message);
      setThirdPartyMcpDraft((current) => ({ ...current, error: message }));
    } finally {
      setMcpApprovingStdioServers(false);
      setMcpReloading(false);
      setMcpDiscoveryLoading(false);
    }
  }

  async function grantFileAccessDirectory(
    scope: "global" | "workspace",
    readOnly = false,
    directoryPath?: string,
  ): Promise<void> {
    const finalDirectoryPath = directoryPath ?? (await pickWorkspaceDirectory()).directoryPath;

    if (!finalDirectoryPath || !fileAccessSettings) {
      return;
    }

    setFileAccessError(null);

    try {
      const response = await updateFileAccessSettings({
        directories: [
          ...fileAccessSettings.directories.map(fileAccessDirectoryUpdate),
          { path: finalDirectoryPath, readOnly, scope },
        ],
      });
      const reload = await reloadMcpServers();

      setFileAccessSettings(response);
      setMcpDiscovery(reload.mcp);
      showToast(`Directory granted (${scope}).`);
    } catch (caught) {
      setFileAccessError(errorMessage(caught));
    }
  }

  async function revokeFileAccessGrant(directory: FileAccessDirectorySummary): Promise<void> {
    if (!fileAccessSettings || directory.grantId === undefined) {
      return;
    }

    setRevokingFileAccessGrantId(directory.grantId);
    setFileAccessError(null);

    try {
      const response = await updateFileAccessSettings({
        directories: fileAccessSettings.directories
          .filter((item) => item.grantId !== directory.grantId)
          .map(fileAccessDirectoryUpdate),
      });
      const reload = await reloadMcpServers();

      setFileAccessSettings(response);
      setMcpDiscovery(reload.mcp);
      showToast("Directory grant revoked.");
    } catch (caught) {
      setFileAccessError(errorMessage(caught));
    } finally {
      setRevokingFileAccessGrantId(null);
    }
  }

  async function revokeAllFileAccessGrants(): Promise<void> {
    if (!fileAccessSettings || fileAccessSettings.directories.length === 0) {
      return;
    }

    setRevokingFileAccessGrantId(-1);
    setFileAccessError(null);

    try {
      const response = await updateFileAccessSettings({ directories: [] });
      const reload = await reloadMcpServers();

      setFileAccessSettings(response);
      setMcpDiscovery(reload.mcp);
      showToast("All directory grants revoked.");
    } catch (caught) {
      setFileAccessError(errorMessage(caught));
    } finally {
      setRevokingFileAccessGrantId(null);
    }
  }

  function showToast(message: string): void {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToast({ id: `toast-${Date.now()}`, message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, toastDismissDelayMs);
  }

  function setProviderDraft(providerId: string, patch: Partial<ProviderDraft>): void {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        ...patch,
      } as ProviderDraft,
    }));
  }

  async function saveProvider(provider: LlmProviderSummary): Promise<void> {
    const draft = providerDrafts[provider.id];

    if (!draft) {
      return;
    }

    setProviderDraft(provider.id, { error: null, saving: true });

    try {
      const secrets: Record<string, string | null> = {};

      for (const envVar of provider.credentialEnvVars) {
        const value = draft.secretValues[envVar]?.trim();

        if (draft.clearSecrets[envVar]) {
          secrets[envVar] = null;
        } else if (value) {
          secrets[envVar] = value;
        }
      }

      const update: LlmProviderSettingsUpdateRequest = {
        baseUrl: draft.baseUrl.trim() || null,
        defaultModel: draft.defaultModel.trim() || null,
        enabled: draft.enabled,
      };

      if (Object.keys(secrets).length > 0) {
        update.secrets = secrets;
      }

      const response = await updateLlmProviderSettings(provider.id, update);

      setProviders(response.providers);
      setProviderDraft(provider.id, {
        clearSecrets: {},
        error: null,
        saving: false,
        secretValues: {},
      });
      showToast(`${provider.label} saved.`);
    } catch (caught) {
      setProviderDraft(provider.id, {
        error: errorMessage(caught),
        saving: false,
      });
    }
  }

  async function detectLocation(): Promise<void> {
    setLocationDetecting(true);
    setCustomizationError(null);

    try {
      const response = await fetchSetupLocation();

      setCustomizationDraft((current) => ({
        ...current,
        location: response.location,
      }));
    } catch (caught) {
      setCustomizationError(errorMessage(caught));
    } finally {
      setLocationDetecting(false);
    }
  }

  async function saveCustomization(): Promise<void> {
    setCustomizationSaving(true);
    setCustomizationError(null);

    try {
      const response = await updateSetup({
        location: customizationDraft.location.trim() || null,
        nickname: customizationDraft.nickname.trim() || null,
        preferredLanguage: customizationDraft.preferredLanguage.trim() || null,
      });
      const promptsResponse = await fetchSystemPromptSettings();

      setSetup(response.setup);
      setPromptSettings(promptsResponse);
      showToast("Customization saved.");
    } catch (caught) {
      setCustomizationError(errorMessage(caught));
    } finally {
      setCustomizationSaving(false);
    }
  }

  async function saveGlobalSidebarWorkspaceVisibility(
    showWorkspaceSessionsInGlobalView: boolean,
  ): Promise<void> {
    const previousSetup = setup;

    setViewCustomizationSaving(true);
    setViewCustomizationError(null);
    setSetup((current) =>
      current ? { ...current, showWorkspaceSessionsInGlobalView } : current,
    );

    try {
      const response = await updateSetup({ showWorkspaceSessionsInGlobalView });

      setSetup(response.setup);
      showToast(
        showWorkspaceSessionsInGlobalView
          ? "Workspace sessions shown in Global view."
          : "Workspace sessions hidden from Global view.",
      );
    } catch (caught) {
      setSetup(previousSetup);
      setViewCustomizationError(errorMessage(caught));
    } finally {
      setViewCustomizationSaving(false);
    }
  }

  async function saveHistorySettings(): Promise<void> {
    setHistorySaving(true);
    setHistoryError(null);

    try {
      const response = await updateHistorySettings({
        includeThinkingHistory: historyDraft.includeThinkingHistory,
        includeToolHistory: historyDraft.includeToolHistory,
        limitReasoningBudget: historyDraft.limitReasoningBudget,
        maxReasoningTimeSeconds: historyDraft.maxReasoningTimeSeconds,
        maxReasoningWords: historyDraft.maxReasoningWords,
      });
      const richResponse = await updateRichFeatureSettings({
        agenticToolTurnLimit: richFeatureDraft.agenticToolTurnLimit,
        agenticToolTurnLimitEnabled: richFeatureDraft.agenticToolTurnLimitEnabled,
      });

      setHistorySettings(response.history);
      setRichFeatureSettings(richResponse.richFeatures);
      setRichFeatureDraft(richResponse.richFeatures);
      showToast("AI behaviour settings saved.");
    } catch (caught) {
      setHistoryError(errorMessage(caught));
    } finally {
      setHistorySaving(false);
    }
  }

  function updateRichFeatureDraft(patch: Partial<RichFeatureSettingsSummary>): void {
    setRichFeatureDraft((current) => ({
      ...current,
      ...patch,
    }));
  }

  async function saveRichFeatureSettings(): Promise<void> {
    setRichFeatureSaving(true);
    setRichFeatureError(null);

    const update: RichFeatureSettingsUpdateRequest = {
      agenticToolTurnLimit: richFeatureDraft.agenticToolTurnLimit,
      agenticToolTurnLimitEnabled: richFeatureDraft.agenticToolTurnLimitEnabled,
      cardsEnabled: richFeatureDraft.cardsEnabled,
      calloutsEnabled: richFeatureDraft.calloutsEnabled,
      followUpsEnabled: richFeatureDraft.followUpsEnabled,
      katexEnabled: richFeatureDraft.katexEnabled,
      plantUmlEnabled: richFeatureDraft.plantUmlEnabled,
      plantUmlFormat: richFeatureDraft.plantUmlFormat,
      plantUmlPrompt: richFeatureDraft.plantUmlPrompt,
      plantUmlServerUrl: richFeatureDraft.plantUmlServerUrl,
      smartEventsEnabled: richFeatureDraft.smartEventsEnabled,
      smartEventsGoogleCalendarEnabled:
        richFeatureDraft.smartEventsGoogleCalendarEnabled,
      smartEventsIcsEnabled: richFeatureDraft.smartEventsIcsEnabled,
      smartEventsOutlookCalendarEnabled:
        richFeatureDraft.smartEventsOutlookCalendarEnabled,
      smartTablesEnabled: richFeatureDraft.smartTablesEnabled,
      timelinesEnabled: richFeatureDraft.timelinesEnabled,
    };

    try {
      const response = await updateRichFeatureSettings(update);

      setRichFeatureSettings(response.richFeatures);
      setRichFeatureDraft(response.richFeatures);
      showToast("Rich features saved.");
    } catch (caught) {
      setRichFeatureError(errorMessage(caught));
    } finally {
      setRichFeatureSaving(false);
    }
  }

  async function saveTrussMcpSettings(): Promise<void> {
    setTrussMcpDraft((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await updateMcpSettings({
        commandRunner: trussMcpDraft.commandRunner,
        playwrightMcp: trussMcpDraft.playwrightMcp,
        sanitizerModelId: trussMcpDraft.sanitizerModelId,
        sanitizerProviderId: trussMcpDraft.sanitizerProviderId,
      });

      setMcpSettings(response.settings);
      setTrussMcpDraft({
        commandRunner: response.settings.commandRunner,
        error: null,
        playwrightMcp: response.settings.playwrightMcp,
        sanitizerModelId: response.settings.sanitizerModelId,
        sanitizerProviderId: response.settings.sanitizerProviderId,
        saving: false,
      });
      setThirdPartyMcpDraft((current) => ({
        ...current,
        configText: response.mcpConfigText,
        mcpConfigPath: response.mcpConfigPath,
      }));
      setMcpSecrets(response.secrets);
      showToast("Truss MCP settings saved.");
    } catch (caught) {
      setTrussMcpDraft((current) => ({
        ...current,
        error: errorMessage(caught),
        saving: false,
      }));
    }
  }

  async function saveMcpConfigText(configText: string): Promise<boolean> {
    const approveStdioServers = shouldRequestExternalStdioApproval(configText);

    if (
      approveStdioServers &&
      !window.confirm(
        "This mcp.json includes active external stdio servers. Approving allows Truss to spawn those local commands after save or reload.",
      )
    ) {
      return false;
    }

    setThirdPartyMcpDraft((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await updateMcpSettings({
        ...(approveStdioServers ? { approveStdioServers: true } : {}),
        mcpConfigText: configText,
      });

      setMcpSettings(response.settings);
      setMcpSecrets(response.secrets);
      setThirdPartyMcpDraft((current) => ({
        ...current,
        configText: response.mcpConfigText,
        error: null,
        mcpConfigPath: response.mcpConfigPath,
        saving: false,
      }));
      return true;
    } catch (caught) {
      setThirdPartyMcpDraft((current) => ({
        ...current,
        error: errorMessage(caught),
        saving: false,
      }));
      return false;
    }
  }

  async function saveThirdPartyMcpSettings(): Promise<boolean> {
    const saved = await saveMcpConfigText(thirdPartyMcpDraft.configText);

    if (saved) {
      showToast("MCP config saved.");
    }

    return saved;
  }

  async function restoreTrussMcpDefault(): Promise<void> {
    setThirdPartyMcpDraft((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await updateMcpSettings({
        restoreTrussMcpDefault: true,
      });

      setMcpSettings(response.settings);
      setMcpSecrets(response.secrets);
      setThirdPartyMcpDraft((current) => ({
        ...current,
        configText: response.mcpConfigText,
        error: null,
        mcpConfigPath: response.mcpConfigPath,
        saving: false,
      }));
      showToast("Truss MCP default restored.");
    } catch (caught) {
      setThirdPartyMcpDraft((current) => ({
        ...current,
        error: errorMessage(caught),
        saving: false,
      }));
    }
  }

  async function saveMcpCredential(): Promise<void> {
    const envVar = thirdPartyMcpDraft.credentialEnvVar.trim().toUpperCase();

    setThirdPartyMcpDraft((current) => ({
      ...current,
      credentialEnvVar: envVar || current.credentialEnvVar,
      error: null,
      saving: true,
    }));

    try {
      const response = await updateMcpSettings({
        mcpSecrets: {
          [envVar]: thirdPartyMcpDraft.credentialValue,
        },
      });

      setMcpSettings(response.settings);
      setMcpSecrets(response.secrets);
      setThirdPartyMcpDraft((current) => ({
        ...current,
        credentialEnvVar: "TRUSS_MCP_",
        credentialValue: "",
        error: null,
        saving: false,
      }));
      showToast("MCP credential saved.");
    } catch (caught) {
      setThirdPartyMcpDraft((current) => ({
        ...current,
        error: errorMessage(caught),
        saving: false,
      }));
    }
  }

  async function removeMcpCredential(envVar: string): Promise<void> {
    setThirdPartyMcpDraft((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await updateMcpSettings({
        mcpSecrets: {
          [envVar]: null,
        },
      });

      setMcpSettings(response.settings);
      setMcpSecrets(response.secrets);
      setThirdPartyMcpDraft((current) => ({
        ...current,
        error: null,
        saving: false,
      }));
      showToast("MCP credential removed.");
    } catch (caught) {
      setThirdPartyMcpDraft((current) => ({
        ...current,
        error: errorMessage(caught),
        saving: false,
      }));
    }
  }

  function setPromptDraft(mode: SystemPromptMode, patch: Partial<PromptDraft>): void {
    setPromptDrafts((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        ...patch,
      },
    }));
  }

  async function savePrompt(mode: SystemPromptMode): Promise<void> {
    const draft = promptDrafts[mode];

    if (!draft) {
      return;
    }

    setPromptDraft(mode, { error: null, saving: true });

    try {
      const response = await updateSystemPromptSettings(mode, {
        template: draft.template,
      });

      setPromptSettings(response);
      setPromptDraft(mode, { error: null, saving: false });
      showToast(`${promptLabel(mode)} prompt saved.`);
    } catch (caught) {
      setPromptDraft(mode, {
        error: errorMessage(caught),
        saving: false,
      });
    }
  }

  function restorePromptDefault(prompt: SystemPromptTemplateSummary): void {
    setPromptDraft(prompt.mode, {
      error: null,
      template: prompt.defaultTemplate,
    });
  }

  function selectSettingsTab(tab: SettingsTabId): void {
    setActiveTab(tab);

    const url = new URL(window.location.href);

    if (tab === "connections") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }

    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function manageMcpServers(): void {
    selectSettingsTab("third-party-mcp");
    setMcpConfigFocusRequest((current) => current + 1);
  }

  const sanitizerModelOptions = buildSanitizerModelOptions(
    providers,
    sanitizerProviderModels,
    trussMcpDraft,
  );
  const fastHelperProfile =
    modelProfiles.find((profile) => profile.id === "fast-helper") ?? null;

  return (
    <main className="relative min-h-screen bg-surface text-on-surface">
      <div className="truss-grid pointer-events-none fixed inset-0 z-0" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1380px] flex-col px-5 py-6 sm:px-8 lg:flex-row lg:gap-8 lg:px-10">
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-64 lg:shrink-0">
          <div className="flex items-center justify-between gap-3 lg:grid lg:gap-4">
            <a
              aria-label="Back to chat"
              className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none"
              href="/"
            >
              <MaterialIcon name="arrow_back" size={20} />
            </a>
            <div className="min-w-0 flex-1 lg:grid lg:gap-1">
              <p className="text-xs font-semibold uppercase text-on-surface-variant">
                Truss
              </p>
              <h1 className="truncate text-2xl font-semibold text-primary">Settings</h1>
            </div>
          </div>

          <div
            aria-label="Settings sections"
            className="mt-5 grid gap-4"
            role="tablist"
          >
            {settingsTabGroups.map((group) => (
              <div className="min-w-0" key={group.label}>
                <p className="mb-2 text-xs font-semibold uppercase text-on-surface-variant">
                  {group.label}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2 lg:grid lg:overflow-visible lg:pb-0">
                  {group.tabs.map((item) => (
                    <button
                      aria-selected={activeTab === item.id}
                      className={[
                        "flex h-10 shrink-0 items-center gap-2 rounded-sm border px-3 text-left text-sm font-medium transition focus:border-outline focus:bg-surface focus:outline-none",
                        activeTab === item.id
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-primary",
                      ].join(" ")}
                      key={item.id}
                      onClick={() => selectSettingsTab(item.id)}
                      role="tab"
                      title={item.description}
                      type="button"
                    >
                      <MaterialIcon name={item.icon} size={18} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="min-w-0 flex-1 py-6 lg:py-0">
          {pageError ? <SettingsAlert tone="error" message={pageError} /> : null}
          {loading ? (
            <div className="flex min-h-[45vh] items-center justify-center text-sm font-medium text-on-surface-variant">
              <span className="truss-spinner mr-3 h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary" />
              Loading settings
            </div>
          ) : (
            <div className="grid gap-8" role="tabpanel">
              {activeTab === "connections" ? (
                <SettingsSection
                  description="Provider configuration and key rotation"
                  icon="hub"
                  id="connections"
                  title="Connections"
                >
                  <div className="grid gap-4">
                    {providers.map((provider) => (
                      <ProviderSettingsPanel
                        draft={providerDrafts[provider.id]}
                        key={provider.id}
                        onDraftChange={(patch) => setProviderDraft(provider.id, patch)}
                        onSave={() => void saveProvider(provider)}
                        provider={provider}
                      />
                    ))}
                  </div>
                </SettingsSection>
              ) : null}

              {activeTab === "customization" ? (
                <SettingsSection
                  description="Optional personalization for prompt templates"
                  icon="tune"
                  id="customization"
                  title="Customization"
                >
                  <article className="grid max-w-[720px] gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
                    <div>
                      <h3 className="text-lg font-semibold text-on-surface">
                        Prompt customization
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                        {personalizationIntro}
                      </p>
                    </div>
                    <div className="grid gap-4">
                      <SettingsTextInput
                        label="What should Truss call you?"
                        onChange={(value) =>
                          setCustomizationDraft((current) => ({ ...current, nickname: value }))
                        }
                        placeholder="e.g., Commander, Doctor, or just your first name"
                        value={customizationDraft.nickname}
                      />
                      <SettingsTextInput
                        helpText={preferredLanguageHelp}
                        label="Preferred response language"
                        onChange={(value) =>
                          setCustomizationDraft((current) => ({
                            ...current,
                            preferredLanguage: value,
                          }))
                        }
                        placeholder="System Default (English)"
                        value={customizationDraft.preferredLanguage}
                      />
                      <label className="grid gap-2">
                        <span className="text-xs font-semibold uppercase text-on-surface-variant">
                          Location
                        </span>
                        <div className="flex min-w-0 gap-2">
                          <input
                            className="h-10 min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface outline-none transition focus:border-outline focus:bg-surface"
                            onChange={(event) =>
                              setCustomizationDraft((current) => ({
                                ...current,
                                location: event.target.value,
                              }))
                            }
                            placeholder="City, region, country"
                            type="text"
                            value={customizationDraft.location}
                          />
                          <div className="group relative shrink-0">
                            <button
                              aria-label="Detect location"
                              className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none disabled:opacity-45"
                              disabled={locationDetecting}
                              onClick={() => void detectLocation()}
                              title={locationAutofillTooltip}
                              type="button"
                            >
                              <MaterialIcon
                                name={locationDetecting ? "sync" : "my_location"}
                                size={19}
                              />
                            </button>
                            <div className="truss-tooltip pointer-events-none absolute bottom-full right-0 z-40 mb-2 hidden w-72 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs leading-5 text-on-surface-variant shadow-panel group-hover:block group-focus-within:block">
                              {locationAutofillTooltip}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs leading-5 text-on-surface-variant">
                          {locationHelp}
                        </span>
                      </label>
                    </div>
                    {customizationError ? (
                      <SettingsAlert tone="error" message={customizationError} />
                    ) : null}
                    <div className="flex justify-end">
                      <PrimaryButton
                        disabled={customizationSaving}
                        icon="save"
                        label={customizationSaving ? "Saving" : "Save customization"}
                        onClick={() => void saveCustomization()}
                      />
                    </div>
                  </article>
                  <article className="mt-4 grid max-w-[720px] gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
                            <MaterialIcon name="view_sidebar" size={18} />
                          </span>
                          <h3 className="text-base font-semibold text-on-surface">
                            Show / Hide workspace sessions in Global view
                          </h3>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                          When this is off, the Global view sidebar lists only conversations
                          without a workspace. Workspace conversations remain available from the
                          Workspaces menu and direct links. Turn it on to include workspace
                          conversations in the Global view sidebar.
                        </p>
                      </div>
                      <SettingsSwitch
                        checked={setup?.showWorkspaceSessionsInGlobalView === true}
                        disabled={viewCustomizationSaving || !setup}
                        label="Show / Hide workspace sessions in Global view"
                        onChange={(checked) =>
                          void saveGlobalSidebarWorkspaceVisibility(checked)
                        }
                      />
                    </div>
                    {viewCustomizationError ? (
                      <SettingsAlert tone="error" message={viewCustomizationError} />
                    ) : null}
                  </article>
                </SettingsSection>
              ) : null}

              {activeTab === "mcp-servers" ? (
                <SettingsSection
                  description="Discovered MCP servers, tools, resources, and prompts"
                  icon="construction"
                  id="mcp-servers"
                  title="MCP Servers"
                >
                  <McpServersSettingsPanel
                    approvingStdioServers={mcpApprovingStdioServers}
                    error={mcpDiscoveryError}
                    loading={mcpDiscoveryLoading}
                    mcp={mcpDiscovery}
                    onApproveStdioServers={() => void approveCurrentMcpStdioServersFromSettings()}
                    onManageServers={manageMcpServers}
                    onReload={() => void reloadMcpServersFromSettings()}
                    onRefresh={() => void loadMcpDiscovery()}
                    reloading={mcpReloading}
                  />
                </SettingsSection>
              ) : null}

              {activeTab === "truss-mcp" ? (
                <SettingsSection
                  description="First-party Truss MCP servers and web tool model settings"
                  icon="travel_explore"
                  id="truss-mcp"
                  title="Truss MCP Settings"
                >
                  <TrussMcpSettingsPanel
                    draft={trussMcpDraft}
                    fastHelperProfile={fastHelperProfile}
                    fileAccess={fileAccessSettings}
                    fileAccessError={fileAccessError}
                    fileAccessLoading={fileAccessLoading}
                    loadingModels={sanitizerModelsLoading}
                    modelOptions={sanitizerModelOptions}
                    onDraftChange={(patch) =>
                      setTrussMcpDraft((current) => ({ ...current, ...patch }))
                    }
                    onRefreshFileAccess={() => void loadFileAccessSettings()}
                    onGrantDirectory={grantFileAccessDirectory}
                    onRevokeAllFileAccessGrants={() => void revokeAllFileAccessGrants()}
                    onRevokeFileAccessGrant={(directory) => void revokeFileAccessGrant(directory)}
                    onSave={() => void saveTrussMcpSettings()}
                    revokingFileAccessGrantId={revokingFileAccessGrantId}
                  />
                </SettingsSection>
              ) : null}

              {activeTab === "third-party-mcp" ? (
                <SettingsSection
                  description="External MCP servers and global mcp.json editing"
                  icon="settings_ethernet"
                  id="third-party-mcp"
                  title="3rd Party MCP"
                >
                  <ThirdPartyMcpSettingsPanel
                    draft={thirdPartyMcpDraft}
                    focusConfigRequest={mcpConfigFocusRequest}
                    mcpSecrets={mcpSecrets}
                    onDraftChange={(patch) =>
                      setThirdPartyMcpDraft((current) => ({ ...current, ...patch }))
                    }
                    onRemoveCredential={(envVar) => void removeMcpCredential(envVar)}
                    onReload={() => void reloadMcpServersFromSettings()}
                    onRestoreTrussDefault={() => void restoreTrussMcpDefault()}
                    onSave={saveThirdPartyMcpSettings}
                    onSaveCredential={() => void saveMcpCredential()}
                    reloading={mcpReloading}
                  />
                </SettingsSection>
              ) : null}

              {activeTab === "system-prompts" ? (
                <SettingsSection
                  description="Conversation and agentic mode model instructions"
                  icon="terminal"
                  id="system-prompts"
                  title="System prompts"
                >
                  <div className="mb-4 flex flex-wrap gap-2">
                    {promptSettings.placeholders.map((placeholder) => (
                      <code
                        className="rounded-sm border border-outline-variant bg-surface-container-low px-2 py-1 text-xs text-on-surface-variant"
                        key={placeholder.key}
                      >
                        {"{{"}{placeholder.key}{"}}"}
                      </code>
                    ))}
                  </div>
                  <div className="grid gap-5">
                    {promptSettings.prompts.map((prompt) => (
                      <PromptEditor
                        draft={promptDrafts[prompt.mode]}
                        key={prompt.mode}
                        onChange={(template) => setPromptDraft(prompt.mode, { template })}
                        onRestoreDefault={() => restorePromptDefault(prompt)}
                        onSave={() => void savePrompt(prompt.mode)}
                        prompt={prompt}
                        placeholders={promptSettings.placeholders}
                        setup={setup}
                      />
                    ))}
                  </div>
                </SettingsSection>
              ) : null}

              {activeTab === "history" ? (
                <SettingsSection
                  description="Control reasoning budget and which execution details are replayed into later model turns"
                  icon="psychology"
                  id="history"
                  title="AI behaviour"
                >
                  <div className="grid gap-4">
                    <HistoryToggleCard
                      checked={historyDraft.includeThinkingHistory}
                      description="When enabled, provider-exposed assistant thinking from earlier assistant messages is included in later prompt context for the same conversation. It can improve continuity, but it also increases context size and reuses reasoning text."
                      icon="psychology"
                      label="Include thinking history with subsequent turns"
                      onChange={(value) =>
                        setHistoryDraft((current) => ({
                          ...current,
                          includeThinkingHistory: value,
                        }))
                      }
                    />
                    <HistoryToggleCard
                      checked={historyDraft.includeToolHistory}
                      description="When enabled, persisted tool calls and results should be replayed into later model context. The preference is saved now; replay is inactive until chat tool calls/results are stored in session history."
                      icon="construction"
                      label="Include tool history with subsequent turns"
                      onChange={(value) =>
                        setHistoryDraft((current) => ({
                          ...current,
                          includeToolHistory: value,
                        }))
                      }
                    />
                    <HistoryToggleCard
                      checked={historyDraft.limitReasoningBudget}
                      description='Monitors supported responses that expose reasoning through thinking fields or <think>...</think> blocks. Tool-running time counts against the time limit. If the budget is exhausted, Truss asks for a direct answer with the same conversation context, prepends "I reasoned enough. Now let me answer directly.", and asks the provider to disable reasoning for the retry. Partial thinking from the aborted attempt is copied into the final response once done.'
                      icon="timer"
                      label="Limit reasoning budget"
                      onChange={(value) =>
                        setHistoryDraft((current) => ({
                          ...current,
                          limitReasoningBudget: value,
                        }))
                      }
                    >
                      {historyDraft.limitReasoningBudget ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <SettingsNumberInput
                            helpText="Seconds allowed after thinking or tool running starts."
                            label="Max reasoning time"
                            min={0}
                            onChange={(value) =>
                              setHistoryDraft((current) => ({
                                ...current,
                                maxReasoningTimeSeconds: value,
                              }))
                            }
                            suffix="seconds"
                            value={historyDraft.maxReasoningTimeSeconds}
                          />
                          <SettingsNumberInput
                            helpText="Maximum words counted inside reasoning or thinking content only."
                            label="Max reasoning words"
                            min={0}
                            onChange={(value) =>
                              setHistoryDraft((current) => ({
                                ...current,
                                maxReasoningWords: value,
                              }))
                            }
                            value={historyDraft.maxReasoningWords}
                          />
                        </div>
                      ) : null}
                    </HistoryToggleCard>
                    <HistoryToggleCard
                      checked={richFeatureDraft.agenticToolTurnLimitEnabled}
                      description="Maximum number of tool-use turns the agent may take before stopping and asking for guidance. Default: 300."
                      icon="account_tree"
                      label="Agentic tool turn limit"
                      onChange={(value) =>
                        setRichFeatureDraft((current) => ({
                          ...current,
                          agenticToolTurnLimitEnabled: value,
                        }))
                      }
                    >
                      <div className="grid gap-3">
                        <label className="flex items-center gap-3 text-sm text-on-surface">
                          <input
                            checked={richFeatureDraft.agenticToolTurnLimitEnabled}
                            className="h-4 w-4 accent-primary"
                            onChange={() =>
                              setRichFeatureDraft((current) => ({
                                ...current,
                                agenticToolTurnLimitEnabled: true,
                              }))
                            }
                            type="radio"
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="font-medium">Enable turn limit</span>
                            <span className="flex w-36 min-w-0 items-center rounded-sm border border-outline-variant bg-surface-container-low transition focus-within:border-outline focus-within:bg-surface">
                              <input
                                aria-label="Agentic tool turn limit"
                                className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm text-on-surface outline-none"
                                min={1}
                                onChange={(event) =>
                                  setRichFeatureDraft((current) => ({
                                    ...current,
                                    agenticToolTurnLimit: normalizeIntegerInput(
                                      event.target.value,
                                      1,
                                    ),
                                  }))
                                }
                                type="number"
                                value={richFeatureDraft.agenticToolTurnLimit}
                              />
                              <span className="shrink-0 border-l border-outline-variant px-2 text-xs font-medium text-on-surface-variant">
                                turns
                              </span>
                            </span>
                            <span className="text-on-surface-variant">per agentic turn</span>
                          </span>
                        </label>
                        <label className="flex items-center gap-3 text-sm text-on-surface">
                          <input
                            checked={!richFeatureDraft.agenticToolTurnLimitEnabled}
                            className="h-4 w-4 accent-primary"
                            onChange={() =>
                              setRichFeatureDraft((current) => ({
                                ...current,
                                agenticToolTurnLimitEnabled: false,
                              }))
                            }
                            type="radio"
                          />
                          <span>
                            <span className="font-medium">Unlimited</span>
                            <span className="ml-2 text-on-surface-variant">
                              use with caution
                            </span>
                          </span>
                        </label>
                      </div>
                    </HistoryToggleCard>
                  </div>
                  {historyError ? <SettingsAlert tone="error" message={historyError} /> : null}
                  <div className="mt-4 flex justify-end">
                    <PrimaryButton
                      disabled={historySaving}
                      icon="save"
                      label={historySaving ? "Saving" : "Save AI behaviour"}
                      onClick={() => void saveHistorySettings()}
                    />
                  </div>
                </SettingsSection>
              ) : null}

              {activeTab === "rich-features" ? (
                <SettingsSection
                  description="Control interactive markdown rendering and related model instructions"
                  icon="auto_awesome"
                  id="rich-features"
                  title="Rich features"
                >
                  <RichFeaturesPanel
                    draft={richFeatureDraft}
                    error={richFeatureError}
                    onChange={updateRichFeatureDraft}
                    onSave={() => void saveRichFeatureSettings()}
                    saving={richFeatureSaving}
                    saved={richFeatureSettings}
                  />
                </SettingsSection>
              ) : null}

              {activeTab === "system" ? (
                <SettingsSection
                  description="Local Truss storage paths"
                  icon="dns"
                  id="system"
                  title="System"
                >
                  {systemSettings ? <SystemPaths settings={systemSettings} /> : null}
                </SettingsSection>
              ) : null}

              {activeTab === "processes" ? (
                <SettingsSection
                  description="View and terminate active local Truss servers"
                  icon="memory"
                  id="processes"
                  title="Spawned processes"
                >
                  <SpawnedProcessesPanel />
                </SettingsSection>
              ) : null}
            </div>
          )}
        </section>
      </div>
      <ToastNotification toast={toast} />
    </main>
  );
}
