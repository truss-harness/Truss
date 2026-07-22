import type { LlmProvider } from "../types.ts";

export const openRouterProvider: LlmProvider = {
  id: "openrouter",
  label: "OpenRouter",
  kind: "hosted",
  credentialEnvVars: ["OPENROUTER_API_KEY"],
  baseUrlEnvVar: "OPENROUTER_BASE_URL",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  defaultEnabled: false,
  defaultModel: "z-ai/glm-5.2",
  defaultModels: ["z-ai/glm-5.2", "xiaomi/mimo-v2.5-pro", "anthropic/claude-sonnet-4.6", "deepseek/deepseek-v4-pro", "qwen/qwen3.7-plus", "minimax/minimax-m3"],
};
