import type { LlmProvider } from "../types.ts";

export const openAiProvider: LlmProvider = {
  id: "openai",
  label: "OpenAI",
  kind: "hosted",
  credentialEnvVars: ["OPENAI_API_KEY"],
  baseUrlEnvVar: "OPENAI_BASE_URL",
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultEnabled: false,
  defaultModel: "gpt-5.4-mini",
  defaultModels: ["gpt-5.4-mini", "gpt-5.5", "gpt-5.4-nano"],
};
