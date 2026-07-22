import type { LlmProvider } from "../types.ts";

export const llamaCppProvider: LlmProvider = {
  id: "llamacpp",
  label: "llama.cpp",
  kind: "local",
  credentialEnvVars: [],
  baseUrlEnvVar: "LLAMACPP_BASE_URL",
  defaultBaseUrl: "http://127.0.0.1:8080/v1",
  defaultEnabled: false,
  defaultModel: "local-model",
  defaultModels: ["local-model"],
};
