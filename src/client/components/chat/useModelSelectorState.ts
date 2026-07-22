import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLlmProviderModels, fetchSession } from "../../api.ts";
import type {
  LlmModelProfileId,
  LlmProviderSummary,
  McpDiscoverySummary,
  SessionInfo,
} from "../../../shared/protocol.ts";
import type { ModelSelectorOption, SelectedModel } from "../ModelSelector.tsx";
import type { ComposerMode } from "./types.ts";

interface ProviderModelList {
  models: string[];
  source: ModelSelectorOption["source"];
}

export function useModelSelectorState(mode: ComposerMode): {
  loading: boolean;
  onModelChange(selection: SelectedModel): void;
  options: ModelSelectorOption[];
  selected: SelectedModel | null;
  session: SessionInfo | null;
  setSelectionForMode(mode: ComposerMode, selection: SelectedModel): void;
  updateMcpSummary(mcp: McpDiscoverySummary): void;
} {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModelList>>({});
  const [loading, setLoading] = useState(true);
  const [selectedByMode, setSelectedByMode] = useState<Record<ComposerMode, SelectedModel | null>>({
    agent: null,
    conversation: null,
  });
  const initialModeRef = useRef(mode);
  const defaults = useMemo(() => modelDefaultsForSession(session), [session]);
  const options = useMemo(
    () => buildModelOptions(session, providerModels, profileIdForMode(mode)),
    [mode, providerModels, session],
  );
  const selected = selectedByMode[mode] ?? selectedByMode[otherModeForMode(mode)] ?? defaults[mode];

  useEffect(() => {
    let cancelled = false;

    async function loadModelOptions(): Promise<void> {
      setLoading(true);

      try {
        const nextSession = await fetchSession();

        if (cancelled) {
          return;
        }

        setSession(nextSession);
        setSelectedByMode((current) => {
          const targetMode = initialModeRef.current;

          return {
            ...current,
            [targetMode]:
              current[targetMode] ?? defaultSelection(nextSession, profileIdForMode(targetMode)),
          };
        });

        const configuredProviders = nextSession.llmProviders.filter(configuredProvider);
        const fallbackLists = Object.fromEntries(
          configuredProviders.map((provider) => [
            provider.id,
            {
              models: providerModelFallbacks(provider),
              source: "configured" as const,
            },
          ]),
        );
        setProviderModels(fallbackLists);

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
          setProviderModels(Object.fromEntries(fetchedLists));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadModelOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    loading,
    onModelChange: (selection) =>
      setSelectedByMode((current) => ({
        ...current,
        [mode]: selection,
      })),
    options,
    selected,
    session,
    setSelectionForMode: (targetMode, selection) =>
      setSelectedByMode((current) => ({
        ...current,
        [targetMode]: selection,
      })),
    updateMcpSummary: (mcp) =>
      setSession((current) => (current ? { ...current, mcp } : current)),
  };
}

function modelDefaultsForSession(
  session: SessionInfo | null,
): Record<ComposerMode, SelectedModel | null> {
  return {
    agent: defaultSelection(session, "agentic"),
    conversation: defaultSelection(session, "conversation"),
  };
}

function defaultSelection(
  session: SessionInfo | null,
  profileId: LlmModelProfileId,
): SelectedModel | null {
  const profile = session?.modelProfiles.find((item) => item.id === profileId);

  if (!profile) {
    return null;
  }

  return {
    modelId: profile.modelId,
    providerId: profile.providerId,
  };
}

function buildModelOptions(
  session: SessionInfo | null,
  providerModels: Record<string, ProviderModelList>,
  profileId: LlmModelProfileId,
): ModelSelectorOption[] {
  if (!session) {
    return [];
  }

  const options: ModelSelectorOption[] = [];
  const defaultProfile = session.modelProfiles.find((profile) => profile.id === profileId);

  if (defaultProfile) {
    options.push({
      isDefault: true,
      modelId: defaultProfile.modelId,
      providerId: defaultProfile.providerId,
      providerLabel: defaultProfile.providerLabel,
      source: "default",
    });
  }

  for (const provider of session.llmProviders.filter(configuredProvider)) {
    const modelList = providerModels[provider.id];
    const models = modelList?.models ?? providerModelFallbacks(provider);

    for (const modelId of models) {
      options.push({
        modelId,
        providerId: provider.id,
        providerLabel: provider.label,
        source: modelList?.source ?? "configured",
      });
    }
  }

  return uniqueModelOptions(options);
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

function profileIdForMode(mode: ComposerMode): LlmModelProfileId {
  return mode === "agent" ? "agentic" : "conversation";
}

function otherModeForMode(mode: ComposerMode): ComposerMode {
  return mode === "agent" ? "conversation" : "agent";
}

function configuredProvider(provider: LlmProviderSummary): boolean {
  return provider.enabled && provider.configured;
}

function providerModelFallbacks(provider: LlmProviderSummary): string[] {
  return uniqueStrings([
    provider.defaultModel,
    ...provider.models,
  ]);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
