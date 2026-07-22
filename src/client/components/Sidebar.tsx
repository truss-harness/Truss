import { useEffect, useState } from "react";
import type {
  LlmModelProfileUpdateRequest,
  LlmProviderSettingsUpdateRequest,
  SessionInfo,
} from "../../shared/protocol.ts";
import { updateLlmProviderSettings, updateModelProfile } from "../api.ts";
import { Panel } from "./Panel.tsx";

interface SidebarProps {
  onSessionRefresh(): Promise<void>;
  session: SessionInfo | null;
}

interface ProviderDraft {
  baseUrl: string;
  clearSecrets: Record<string, boolean>;
  defaultModel: string;
  enabled: boolean;
  error: string | null;
  modelsText: string;
  saving: boolean;
  secretValues: Record<string, string>;
}

interface ModelProfileDraft {
  contextSize: string;
  error: string | null;
  modelId: string;
  providerId: string;
  saving: boolean;
  temperature: string;
  topK: string;
  topP: string;
}

export function Sidebar({ onSessionRefresh, session }: SidebarProps) {
  return (
    <aside className="animate-rise space-y-5 [animation-delay:160ms]">
      <Panel title="Harness Contract">
        <ul className="space-y-3 text-sm leading-6 text-on-surface-variant">
          <li>
            POST commands enter through <code>/api/commands</code>.
          </li>
          <li>
            SSE events stream from <code>/api/events</code>.
          </li>
          <li>Tool requests pause backend flow until the browser resolves them.</li>
          <li>The markdown renderer is local and component-aware by design.</li>
        </ul>
      </Panel>

      <Panel title="Modular Backends">
        <div className="space-y-3 text-sm leading-6 text-on-surface-variant">
          <p>
            MCP servers connected: <strong>{session?.mcp.connectedServers ?? 0}</strong> of{" "}
            <strong>{session?.mcp.discoveredServers ?? 0}</strong>.
          </p>
          <p>
            MCP tools available: <strong>{session?.mcp.availableTools ?? 0}</strong>.
          </p>
          <p>
            LLM providers registered: <strong>{session?.llmProviders.length ?? 0}</strong>.
          </p>
          <p>
            Skills loaded: <strong>{session?.skills.activeSkills ?? 0}</strong> active of{" "}
            <strong>{session?.skills.discoveredSkills ?? 0}</strong> discovered.
          </p>
          <p>Add new MCP loaders or LLM adapters as isolated modules.</p>
        </div>
      </Panel>

      <ModelProfileSettings onSessionRefresh={onSessionRefresh} session={session} />
      <ProviderSettings onSessionRefresh={onSessionRefresh} session={session} />
    </aside>
  );
}

function ModelProfileSettings({ onSessionRefresh, session }: SidebarProps) {
  const [drafts, setDrafts] = useState<Record<string, ModelProfileDraft>>({});

  useEffect(() => {
    if (!session) {
      return;
    }

    setDrafts((current) => {
      const next = { ...current };

      for (const profile of session.modelProfiles) {
        if (next[profile.id]?.saving) {
          continue;
        }

        next[profile.id] = {
          contextSize: profile.parameters.contextSize?.toString() ?? "",
          error: null,
          modelId: profile.modelId,
          providerId: profile.providerId,
          saving: false,
          temperature: profile.parameters.temperature?.toString() ?? "",
          topK: profile.parameters.topK?.toString() ?? "",
          topP: profile.parameters.topP?.toString() ?? "",
        };
      }

      return next;
    });
  }, [session]);

  async function saveProfile(profileId: string): Promise<void> {
    const draft = drafts[profileId];

    if (!draft) {
      return;
    }

    setProfileDraft(profileId, { saving: true, error: null });

    try {
      const update: LlmModelProfileUpdateRequest = {
        providerId: draft.providerId,
        modelId: draft.modelId,
        parameters: {
          temperature: parseNullableNumber(draft.temperature),
          topP: parseNullableNumber(draft.topP),
          topK: parseNullableInteger(draft.topK),
          contextSize: parseNullableInteger(draft.contextSize),
        },
      };

      await updateModelProfile(profileId, update);
      await onSessionRefresh();
      setProfileDraft(profileId, { saving: false });
    } catch (error) {
      setProfileDraft(profileId, {
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function setProfileDraft(profileId: string, patch: Partial<ModelProfileDraft>): void {
    setDrafts((current) => ({
      ...current,
      [profileId]: {
        ...current[profileId],
        ...patch,
      } as ModelProfileDraft,
    }));
  }

  return (
    <Panel title="Model Defaults">
      <div className="space-y-5 text-sm text-on-surface-variant">
        {(session?.modelProfiles ?? []).map((profile) => {
          const draft = drafts[profile.id];
          const selectedProvider = session?.llmProviders.find(
            (provider) => provider.id === draft?.providerId,
          );

          if (!draft) {
            return null;
          }

          return (
            <div
              key={profile.id}
              className="border-t border-outline-variant pt-4 first:border-t-0 first:pt-0"
            >
              <div>
                <h3 className="text-base font-semibold text-on-surface">{profile.label}</h3>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                  {profile.description}
                </p>
              </div>

              <div className="mt-3 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                    Provider
                  </span>
                  <select
                    className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    onChange={(event) =>
                      setProfileDraft(profile.id, { providerId: event.target.value })
                    }
                    value={draft.providerId}
                  >
                    {(session?.llmProviders ?? []).map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                    Model
                  </span>
                  <input
                    className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    list={`models-${profile.id}`}
                    onChange={(event) => setProfileDraft(profile.id, { modelId: event.target.value })}
                    type="text"
                    value={draft.modelId}
                  />
                  <datalist id={`models-${profile.id}`}>
                    {(selectedProvider?.models ?? []).map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <ParameterInput
                    label="Temp"
                    onChange={(value) => setProfileDraft(profile.id, { temperature: value })}
                    step="0.05"
                    value={draft.temperature}
                  />
                  <ParameterInput
                    label="top_p"
                    onChange={(value) => setProfileDraft(profile.id, { topP: value })}
                    step="0.05"
                    value={draft.topP}
                  />
                  <ParameterInput
                    label="top_k"
                    onChange={(value) => setProfileDraft(profile.id, { topK: value })}
                    step="1"
                    value={draft.topK}
                  />
                  <ParameterInput
                    label="Context"
                    onChange={(value) => setProfileDraft(profile.id, { contextSize: value })}
                    step="512"
                    value={draft.contextSize}
                  />
                </div>

                {draft.error ? <p className="text-xs text-error">{draft.error}</p> : null}

                <button
                  className="rounded border border-primary bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={draft.saving}
                  onClick={() => void saveProfile(profile.id)}
                  type="button"
                >
                  {draft.saving ? "Saving" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ParameterInput({
  label,
  onChange,
  step,
  value,
}: {
  label: string;
  onChange(value: string): void;
  step: string;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
        {label}
      </span>
      <input
        className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        onChange={(event) => onChange(event.target.value)}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function parseNullableNumber(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInteger(value: string): number | null {
  const parsed = parseNullableNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function ProviderSettings({ onSessionRefresh, session }: SidebarProps) {
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});

  useEffect(() => {
    if (!session) {
      return;
    }

    setDrafts((current) => {
      const next = { ...current };

      for (const provider of session.llmProviders) {
        if (next[provider.id]?.saving) {
          continue;
        }

        next[provider.id] = {
          baseUrl: provider.baseUrl,
          clearSecrets: {},
          defaultModel: provider.defaultModel ?? "",
          enabled: provider.enabled,
          error: null,
          modelsText: provider.models.join(", "),
          saving: false,
          secretValues: {},
        };
      }

      return next;
    });
  }, [session]);

  async function saveProvider(providerId: string): Promise<void> {
    const draft = drafts[providerId];

    if (!draft) {
      return;
    }

    const provider = session?.llmProviders.find((item) => item.id === providerId);

    if (!provider) {
      return;
    }

    setDraft(providerId, { saving: true, error: null });

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
        enabled: draft.enabled,
        baseUrl: draft.baseUrl.trim() || null,
        defaultModel: draft.defaultModel.trim() || null,
        models: draft.modelsText
          .split(/[\n,]/)
          .map((model) => model.trim())
          .filter(Boolean),
      };

      if (Object.keys(secrets).length > 0) {
        update.secrets = secrets;
      }

      await updateLlmProviderSettings(providerId, update);
      await onSessionRefresh();
      setDraft(providerId, { saving: false, secretValues: {}, clearSecrets: {} });
    } catch (error) {
      setDraft(providerId, {
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function setDraft(providerId: string, patch: Partial<ProviderDraft>): void {
    setDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        ...patch,
      } as ProviderDraft,
    }));
  }

  return (
    <Panel title="AI Providers">
      <div className="space-y-5 text-sm text-on-surface-variant">
        {(session?.llmProviders ?? []).map((provider) => {
          const draft = drafts[provider.id];

          if (!draft) {
            return null;
          }

          return (
            <div
              key={provider.id}
              className="border-t border-outline-variant pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-on-surface">{provider.label}</h3>
                  <p className="font-mono text-xs uppercase tracking-[0.12em] text-on-surface-variant">
                    {provider.kind}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-on-surface">
                  <input
                    checked={draft.enabled}
                    className="h-4 w-4 accent-primary"
                    onChange={(event) => setDraft(provider.id, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  Enabled
                </label>
              </div>

              <div className="mt-3 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                    Base URL
                  </span>
                  <input
                    className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    onChange={(event) => setDraft(provider.id, { baseUrl: event.target.value })}
                    type="url"
                    value={draft.baseUrl}
                  />
                  <span className="text-xs text-on-surface-variant">
                    Source: {provider.baseUrlSource}
                  </span>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                    Default Model
                  </span>
                  <input
                    className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    onChange={(event) => setDraft(provider.id, { defaultModel: event.target.value })}
                    type="text"
                    value={draft.defaultModel}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                    Models
                  </span>
                  <textarea
                    className="min-h-20 w-full resize-y rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs leading-5 text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    onChange={(event) => setDraft(provider.id, { modelsText: event.target.value })}
                    value={draft.modelsText}
                  />
                </label>

                {provider.secrets.map((secret) => (
                  <div key={secret.envVar} className="grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-semibold text-on-surface-variant">
                        {secret.envVar}
                      </span>
                      <span className="text-xs text-on-surface-variant">
                        {secret.configured
                          ? `${secret.source}${secret.encrypted ? " encrypted" : ""}`
                          : "missing"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        onChange={(event) =>
                          setDraft(provider.id, {
                            secretValues: {
                              ...draft.secretValues,
                              [secret.envVar]: event.target.value,
                            },
                            clearSecrets: {
                              ...draft.clearSecrets,
                              [secret.envVar]: false,
                            },
                          })
                        }
                        placeholder="New value"
                        type="password"
                        value={draft.secretValues[secret.envVar] ?? ""}
                      />
                      <button
                        className="rounded border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface hover:border-error hover:text-error"
                        onClick={() =>
                          setDraft(provider.id, {
                            clearSecrets: {
                              ...draft.clearSecrets,
                              [secret.envVar]: true,
                            },
                            secretValues: {
                              ...draft.secretValues,
                              [secret.envVar]: "",
                            },
                          })
                        }
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ))}

                {draft.error ? <p className="text-xs text-error">{draft.error}</p> : null}

                <button
                  className="rounded border border-primary bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={draft.saving}
                  onClick={() => void saveProvider(provider.id)}
                  type="button"
                >
                  {draft.saving ? "Saving" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
