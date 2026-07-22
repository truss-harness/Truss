import type { LlmProvider } from "../types.ts";

export const ollamaProvider: LlmProvider = {
  id: "ollama",
  label: "Ollama",
  kind: "local",
  credentialEnvVars: [],
  baseUrlEnvVar: "OLLAMA_BASE_URL",
  defaultBaseUrl: "http://127.0.0.1:11434",
  defaultEnabled: true,
  defaultModel: "llama3.1",
  defaultModels: [],
};
