import type { LlmProvider } from "../types.ts";

export const openAiCompatibleProvider: LlmProvider = {
  id: "openai-compatible",
  label: "OpenAI compliant endpoint",
  kind: "custom",
  credentialEnvVars: ["OPENAI_COMPATIBLE_API_KEY"],
  credentialRequired: false,
  baseUrlEnvVar: "OPENAI_COMPATIBLE_BASE_URL",
  defaultBaseUrl: "http://127.0.0.1:8000/v1",
  defaultEnabled: false,
  defaultModel: "local-model",
  defaultModels: ["local-model"],
};
