import type { LlmProviderSummary } from "../../shared/protocol.ts";
import type { SecretEnvStore } from "../config/env.ts";
import type {
  LlmProviderSettings,
  LlmProviderSettingsDefaults,
} from "../storage/settings.ts";
import { llamaCppProvider } from "./providers/llamacpp.ts";
import { ollamaProvider } from "./providers/ollama.ts";
import { openAiCompatibleProvider } from "./providers/openai-compatible.ts";
import { openAiProvider } from "./providers/openai.ts";
import { openRouterProvider } from "./providers/openrouter.ts";
import type { LlmProvider } from "./types.ts";

export const llmProviders: LlmProvider[] = [
  openAiProvider,
  openRouterProvider,
  openAiCompatibleProvider,
  ollamaProvider,
  llamaCppProvider,
];

export function getLlmProvider(providerId: string): LlmProvider | null {
  return llmProviders.find((provider) => provider.id === providerId) ?? null;
}

export function getLlmProviderSettingsDefaults(): LlmProviderSettingsDefaults[] {
  return llmProviders.map((provider) => ({
    providerId: provider.id,
    enabled: provider.defaultEnabled,
    baseUrl: null,
    defaultModel: provider.defaultModel ?? null,
    models: provider.defaultModels,
  }));
}

export function summarizeLlmProviders(options: {
  env: NodeJS.ProcessEnv;
  secretEnv: SecretEnvStore;
  settings: Map<string, LlmProviderSettings>;
}): LlmProviderSummary[] {
  return llmProviders.map((provider) => {
    const settings = options.settings.get(provider.id) ?? defaultSettings(provider);
    const baseUrl = resolveBaseUrl(provider, settings, options.env);
    const secrets = provider.credentialEnvVars.map((envVar) =>
      options.secretEnv.describeSecret(envVar),
    );
    const credentialRequired = provider.credentialRequired ?? provider.credentialEnvVars.length > 0;
    const credentialConfigured =
      !credentialRequired || secrets.every((secret) => secret.configured);
    const models = settings.models.length > 0 ? settings.models : provider.defaultModels;
    const defaultModel = settings.defaultModel ?? provider.defaultModel ?? models[0];

    return {
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      baseUrl: baseUrl.value,
      baseUrlSource: baseUrl.source,
      configured: Boolean(baseUrl.value) && credentialConfigured,
      credentialRequired,
      enabled: settings.enabled,
      credentialEnvVars: provider.credentialEnvVars,
      secrets,
      defaultModel,
      models,
    };
  });
}

function defaultSettings(provider: LlmProvider): LlmProviderSettings {
  return {
    providerId: provider.id,
    enabled: provider.defaultEnabled,
    baseUrl: null,
    defaultModel: provider.defaultModel ?? null,
    models: provider.defaultModels,
  };
}

function resolveBaseUrl(
  provider: LlmProvider,
  settings: LlmProviderSettings,
  env: NodeJS.ProcessEnv,
): { value: string; source: LlmProviderSummary["baseUrlSource"] } {
  if (settings.baseUrl) {
    return { value: settings.baseUrl, source: "settings" };
  }

  const envBaseUrl = provider.baseUrlEnvVar ? env[provider.baseUrlEnvVar] : undefined;

  if (envBaseUrl) {
    return { value: envBaseUrl, source: "env" };
  }

  return { value: provider.defaultBaseUrl, source: "default" };
}
