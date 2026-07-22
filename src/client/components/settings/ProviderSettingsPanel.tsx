import type { LlmProviderSummary } from "../../../shared/protocol.ts";
import {
  PrimaryButton,
  SettingsAlert,
  SettingsSwitch,
  SettingsTextInput,
} from "./SettingsControls.tsx";
import type { ProviderDraft } from "./types.ts";

export function ProviderSettingsPanel({
  draft,
  onDraftChange,
  onSave,
  provider,
}: {
  draft: ProviderDraft | undefined;
  onDraftChange(patch: Partial<ProviderDraft>): void;
  onSave(): void;
  provider: LlmProviderSummary;
}) {
  if (!draft) {
    return null;
  }

  return (
    <article className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-on-surface">{provider.label}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold uppercase text-on-surface-variant">
            <span>{provider.kind}</span>
            <span>{provider.configured ? "configured" : "not configured"}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">
            {providerDescription(provider)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-on-surface">
          <SettingsSwitch
            checked={draft.enabled}
            label={`${provider.label} enabled`}
            onChange={(enabled) => onDraftChange({ enabled })}
          />
        </div>
      </div>

      <div
        aria-hidden={!draft.enabled}
        className={[
          "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
          draft.enabled
            ? "grid-rows-[1fr] translate-y-0 opacity-100"
            : "grid-rows-[0fr] -translate-y-1 opacity-0",
        ].join(" ")}
        inert={!draft.enabled}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-4">
            <p className="rounded-sm border border-outline-variant bg-surface px-3 py-2 text-sm leading-6 text-on-surface-variant">
              Current Base URL: <code className="font-mono text-xs">{provider.baseUrl}</code>.
              Source: {baseUrlSourceLabel(provider.baseUrlSource)}.
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="grid gap-2">
                <SettingsTextInput
                  label="Base URL"
                  mono
                  onChange={(value) => onDraftChange({ baseUrl: value })}
                  value={draft.baseUrl}
                />
                <p className="text-xs leading-5 text-on-surface-variant">
                  {baseUrlExplanation(provider)}
                </p>
              </div>
              <div className="grid gap-2">
                <SettingsTextInput
                  label="Default model"
                  mono
                  onChange={(value) => onDraftChange({ defaultModel: value })}
                  value={draft.defaultModel}
                />
                <p className="text-xs leading-5 text-on-surface-variant">
                  The model Truss uses for this provider when no model profile gives a more
                  specific model.
                </p>
              </div>
            </div>

            {provider.secrets.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {provider.secrets.map((secret) => (
                  <div
                    className="grid gap-2 rounded-sm border border-outline-variant/70 bg-surface px-3 py-3"
                    key={secret.envVar}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-on-surface">
                        {secret.envVar}
                      </span>
                      <span className="text-xs font-medium text-on-surface-variant">
                        {secret.configured
                          ? `${secret.source}${secret.encrypted ? " encrypted" : ""}`
                          : "missing"}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-on-surface-variant">
                      Paste a new value to rotate this key. Existing key values are never
                      returned for display.
                    </p>
                    <div className="flex min-w-0 gap-2">
                      <input
                        className="h-10 min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-low px-3 font-mono text-xs text-on-surface outline-none transition focus:border-outline focus:bg-surface"
                        onChange={(event) =>
                          onDraftChange({
                            clearSecrets: {
                              ...draft.clearSecrets,
                              [secret.envVar]: false,
                            },
                            secretValues: {
                              ...draft.secretValues,
                              [secret.envVar]: event.target.value,
                            },
                          })
                        }
                        placeholder="New key value"
                        type="password"
                        value={draft.secretValues[secret.envVar] ?? ""}
                      />
                      <button
                        className="h-10 shrink-0 rounded-sm border border-outline-variant px-3 text-xs font-semibold text-on-surface-variant transition hover:border-error hover:text-error focus:border-error focus:text-error focus:outline-none"
                        onClick={() =>
                          onDraftChange({
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
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {draft.error ? <SettingsAlert tone="error" message={draft.error} /> : null}

      <div className="mt-4 flex justify-end">
        <PrimaryButton
          disabled={draft.saving}
          icon="save"
          label={draft.saving ? "Saving" : "Save provider"}
          onClick={onSave}
        />
      </div>
    </article>
  );
}


function providerDescription(provider: LlmProviderSummary): string {
  switch (provider.id) {
    case "openai":
      return "Hosted model API from OpenAI. Use it when Truss should send requests through your OpenAI account.";
    case "openrouter":
      return "OpenRouter is a hosted model router and marketplace. It forwards Truss requests to third-party model providers through one OpenRouter API key.";
    case "openai-compatible":
      return "OpenAI compliant endpoint is a custom API target for local servers, proxies, or self-hosted gateways that implement OpenAI-compatible endpoints.";
    case "ollama":
      return "Ollama is a local model server or proxy to Ollama cloud, usually running on this machine.";
    case "llamacpp":
      return "llama.cpp is a local inference server with OpenAI-compatible endpoints.";
    default:
      if (provider.kind === "hosted") {
        return "Hosted provider. Truss sends model requests to an external API endpoint for this provider.";
      }

      if (provider.kind === "local") {
        return "Local provider. Truss sends model requests to a local or LAN service you run.";
      }

      return "Custom provider. Truss sends model requests to the endpoint you configure.";
  }
}


function baseUrlExplanation(provider: LlmProviderSummary): string {
  switch (provider.id) {
    case "openai":
      return "The OpenAI API root. Truss sends OpenAI-compatible chat requests below this /v1 endpoint.";
    case "openrouter":
      return "The OpenRouter API root. Truss sends OpenAI-compatible chat requests here and OpenRouter routes them to the selected model provider.";
    case "openai-compatible":
      return "The HTTP root for an OpenAI-compatible server. Include /v1 when your server expects OpenAI-compatible routes under that prefix.";
    case "ollama":
      return "The Ollama server origin. The default points to the local Ollama service on port 11434.";
    case "llamacpp":
      return "The llama.cpp OpenAI-compatible API root. The default includes /v1 because chat requests are served below that prefix.";
    default:
      return "The endpoint Truss uses when sending requests to this provider. Use the API root expected by the provider or local server.";
  }
}


function baseUrlSourceLabel(source: LlmProviderSummary["baseUrlSource"]): string {
  switch (source) {
    case "settings":
      return "saved in Truss settings";
    case "env":
      return "read from the process environment";
    case "default":
      return "provider default";
  }
}

