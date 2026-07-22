import type {
  CommandRunnerSettingsSummary,
  LlmProviderSummary,
} from "../../../shared/protocol.ts";
import type { ModelSelectorOption, SelectedModel } from "../ModelSelector.tsx";
import type { ProviderDraft, ProviderModelList, TrussMcpDraft } from "./types.ts";

export function buildSanitizerModelOptions(
  providers: LlmProviderSummary[],
  providerModels: Record<string, ProviderModelList>,
  draft: TrussMcpDraft,
): ModelSelectorOption[] {
  const options: ModelSelectorOption[] = [];

  for (const provider of providers.filter(configuredProvider)) {
    const modelList = providerModels[provider.id];
    const models = modelList?.models ?? providerModelFallbacks(provider);

    for (const modelId of uniqueStrings(models)) {
      options.push({
        modelId,
        providerId: provider.id,
        providerLabel: provider.label,
        source: modelList?.source ?? "configured",
      });
    }
  }

  ensureSelectedModelOption(
    options,
    providers,
    draft.sanitizerProviderId,
    draft.sanitizerModelId,
  );
  ensureSelectedModelOption(
    options,
    providers,
    draft.commandRunner.guardProviderId,
    draft.commandRunner.guardModelId,
  );

  return uniqueModelOptions(options);
}


export function sanitizerSelectedModel(draft: TrussMcpDraft): SelectedModel | null {
  if (!draft.sanitizerProviderId || !draft.sanitizerModelId) {
    return null;
  }

  return {
    modelId: draft.sanitizerModelId,
    providerId: draft.sanitizerProviderId,
  };
}


export function commandRunnerSelectedModel(
  settings: CommandRunnerSettingsSummary,
): SelectedModel | null {
  if (!settings.guardProviderId || !settings.guardModelId) {
    return null;
  }

  return {
    modelId: settings.guardModelId,
    providerId: settings.guardProviderId,
  };
}


function ensureSelectedModelOption(
  options: ModelSelectorOption[],
  providers: LlmProviderSummary[],
  providerId: string | null,
  modelId: string | null,
): void {
  if (!providerId || !modelId) {
    return;
  }

  const alreadyListed = options.some(
    (option) => option.providerId === providerId && option.modelId === modelId,
  );

  if (alreadyListed) {
    return;
  }

  const provider = providers.find((item) => item.id === providerId);

  options.push({
    modelId,
    providerId,
    providerLabel: provider?.label ?? providerId,
    source: "configured",
  });
}


function uniqueModelOptions(options: ModelSelectorOption[]): ModelSelectorOption[] {
  const seen = new Set<string>();
  const uniqueOptions: ModelSelectorOption[] = [];

  for (const option of options) {
    const key = `${option.providerId}:${option.modelId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueOptions.push(option);
  }

  return uniqueOptions;
}


export function configuredProvider(provider: LlmProviderSummary): boolean {
  return provider.enabled && provider.configured;
}


export function providerModelFallbacks(provider: LlmProviderSummary): string[] {
  return uniqueStrings([provider.defaultModel, ...provider.models]);
}


function uniqueStrings(values: Array<string | undefined>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();

    if (normalized) {
      unique.add(normalized);
    }
  }

  return [...unique];
}


export function providerToDraft(provider: LlmProviderSummary): ProviderDraft {
  return {
    baseUrl: provider.baseUrl,
    clearSecrets: {},
    defaultModel: provider.defaultModel ?? "",
    enabled: provider.enabled,
    error: null,
    saving: false,
    secretValues: {},
  };
}

