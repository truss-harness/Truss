import type { LlmProviderKind, LlmProviderSummary } from "../../shared/protocol.ts";

export interface LlmProvider {
  id: string;
  label: string;
  kind: LlmProviderKind;
  defaultBaseUrl: string;
  baseUrlEnvVar?: string;
  credentialRequired?: boolean;
  credentialEnvVars: string[];
  defaultEnabled: boolean;
  defaultModel?: string;
  defaultModels: string[];
}

export type { LlmProviderSummary };
