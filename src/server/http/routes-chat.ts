import type {
  AgentSessionSummary,
  ApiError,
  ChatCommandExecutionReference,
  ChatSubAgentReference,
  ChatGeneratedMessageMetadata,
  ChatThinking,
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ChatToolCall,
  ChatToolCallProgress,
  ChatToolSettings,
  ChatUserChoiceRequest,
  HistorySettingsSummary,
  LlmGenerationParameters,
  LlmProviderSummary,
  McpSettingsSummary,
  ScheduledTaskRunTrigger,
  ScheduledTaskSummary,
  StoredChatMessage,
  SystemPromptMode,
} from "../../shared/protocol.ts";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { defaultChatToolSettings } from "../../shared/protocol.ts";
import { appendThinkingTextBlock, mergeChatToolCall } from "../../shared/chat-thinking.ts";
import { toolResultImageData } from "../../shared/tool-result-images.ts";
import type {
  McpToolBinding,
  McpToolFilterOptions,
  OrchestrationTimerFiredNotification,
} from "../mcp/runtime.ts";
import { formatToonToolResult } from "../mcp/toon.ts";
import { validateMcpConfigText } from "../mcp/config-json.ts";
import { writeGlobalMcpConfigText } from "../mcp/config-write.ts";
import { normalizeFileAccessDirectory } from "../security/file-access.ts";
import type { ToolExecutionModelReference } from "../tools/truss-web-tools.ts";
import { trussWebToolTitle } from "../tools/truss-web-tools.ts";
import { defaultProfileIdForAgentSessionType } from "../llm/model-profiles.ts";
import {
  generateChatCompletionWithTools,
  ReasoningBudgetExceededError,
  streamChatCompletion,
} from "../llm/chat-completions.ts";
import type {
  ChatCompletionResult,
  ChatCompletionToolResult,
  LlmToolDefinition,
} from "../llm/chat-completions.ts";
import type {
  ProviderChatMessage,
  ProviderThinkingHistory,
} from "../llm/chat-payloads.ts";
import type { ReasoningBudgetLimit } from "../llm/chat-completions.ts";
import { createReasoningBudgetMonitor } from "../llm/reasoning-budget.ts";
import { mergeChatThinking } from "../llm/thinking.ts";
import { generateConversationTitle } from "../internal-ai/truss-internal-ai-services.ts";
import { getLlmProvider } from "../llm/registry.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";
import {
  renderChatSystemPrompt,
  renderSubAgentSystemPrompt,
  systemPromptModeForSessionType,
  systemPromptTemplateForMode,
} from "./chat-system-prompt.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";
import { validateChatAttachments } from "./chat-attachments.ts";
import { errorForLog, logToStdout, messageFromUnknown } from "../utils/logging.ts";
import {
  createUserChoiceRequest,
  formatUserChoiceToolResult,
  isAskUserChoiceToolBinding,
  askUserChoiceToolName,
  trussChatToolsServerName,
  userChoiceToolTitle,
} from "../tools/user-choice.ts";
import {
  createDirectoryAccessRequest,
  directoryAccessToolTitle,
  isRequestDirectoryAccessToolBinding,
  requestDirectoryAccessToolName,
} from "../tools/file-access-request.ts";
import {
  commandIntentFromMessages,
  commandRunnerToolSecurityFromError,
  commandRunnerToolTitle,
  executeCommandRunnerTool,
  isCommandRunnerToolBinding,
} from "../tools/command-runner.ts";
import {
  createScheduledTaskGlobalAccessRequest,
  isScheduledTaskGlobalAccessToolBinding,
  requestScheduledTaskGlobalAccessToolName,
  scheduledTaskGlobalAccessToolTitle,
} from "../tools/scheduled-task-access-request.ts";

const encoder = new TextEncoder();
const pendingTitleSessionIds = new Set<string>();
const maxMessageCount = 80;
const maxMessageLength = 80_000;
const maxModelLength = 160;
const maxThinkingHistoryLength = 20_000;
const maxToolErrorLength = 4_000;
const maxToolObservationLength = 80_000;
const maxSubAgentTaskLength = 20_000;
const maxSubAgentToolAllowlist = 100;
const maxSubAgentWorkspacePathLength = 4_000;
const maxMcpConfigToolLength = 120_000;
const userChoiceTimeoutMs = 10 * 60 * 1000;
const reasoningBudgetRetryMessage = "I reasoned enough. Now let me answer directly.";
const spawnSubAgentToolName = "spawn_sub_agent";
const editMcpConfigToolName = "edit_mcp_config";

export async function handleChatRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<ChatRequest>(request);
  const validation = validateChatRequest(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  const session = resolveChatSession(validation.request, context);

  if (!session.ok) {
    return json<ApiError>({ error: session.error }, { status: 400 });
  }

  const provider = context.getLlmProviders().find((item) => item.id === session.session.providerId);

  if (!provider) {
    return json<ApiError>({ error: "Unknown LLM provider" }, { status: 400 });
  }

  if (!provider.enabled || !provider.configured) {
    return json<ApiError>(
      { error: `${provider.label} is not enabled or configured.` },
      { status: 400 },
    );
  }

  const providerDefinition = getLlmProvider(provider.id);
  const apiKey = providerDefinition?.credentialEnvVars
    .map((envVar) => context.secretEnv.mergedWithProcessEnv()[envVar])
    .find((value): value is string => Boolean(value));
  const systemPromptMode =
    validation.request.modeOverride ?? systemPromptModeForSessionType(session.session.type);
  const systemPrompt = systemPromptTemplateForMode(context, systemPromptMode);

  scheduleChatTitleGeneration({
    context,
    messages: validation.request.messages,
    session: session.session,
  });

  return streamChatResponse({
    apiKey,
    abortSignal: request.signal,
    context,
    messages: validation.request.messages,
    modelId: session.session.modelId,
    parameters: session.session.parameters,
    provider,
    session: session.session,
    systemPrompt,
    systemPromptMode,
    toolSettings: validation.request.toolSettings,
  });
}

function streamChatResponse({
  abortSignal,
  apiKey,
  context,
  messages,
  modelId,
  parameters,
  provider,
  session,
  systemPrompt,
  systemPromptMode,
  toolSettings,
}: {
  abortSignal?: AbortSignal;
  apiKey?: string;
  context: ServerContext;
  messages: ChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  session: AgentSessionSummary;
  systemPrompt: string;
  systemPromptMode: SystemPromptMode;
  toolSettings: ChatToolSettings;
}): Response {
  const historySettings = context.historySettings.getHistorySettings();
  const richFeatureSettings = context.richFeatures.getRichFeatureSettings();
  const mcpToolDefinitions = context.mcp.getToolDefinitions(toolSettings);
  const allowSubAgents = systemPromptMode === "agentic" && session.type === "agentic";
  const toolDefinitions = chatToolDefinitionsForMode(mcpToolDefinitions, allowSubAgents);
  const agenticToolTurnLimit =
    systemPromptMode === "agentic" && richFeatureSettings.agenticToolTurnLimitEnabled
      ? richFeatureSettings.agenticToolTurnLimit
      : null;
  const providerMessages: ProviderChatMessage[] = historySettings.includeThinkingHistory
    ? includeThinkingHistory(
        messages,
        context.chatMessages.listSessionMessages(session.id),
      )
    : messages;
  const reasoningBudget = reasoningBudgetForRequest(historySettings, provider, modelId);
  const systemMessage: ChatMessage = {
    role: "system",
    content: renderChatSystemPrompt({
      context,
      session,
      systemPrompt,
      toolDefinitions,
    }),
  };

  context.chatMessages.syncSessionMessages(session.id, messages);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        throwIfChatRequestAborted(abortSignal);
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      send({
        type: "start",
        sessionId: session.id,
        providerId: provider.id,
        providerLabel: provider.label,
        modelId,
        title: session.title,
      });

      try {
        const streamCompletion = (disableReasoning: boolean) =>
          streamChatCompletion({
            apiKey,
            disableReasoning,
            messages: [
              systemMessage,
              ...(disableReasoning
                ? prependReasoningBudgetRetryMessage(providerMessages)
                : providerMessages),
            ],
            modelId,
            onContentDelta: (delta) =>
              send({
                type: "content_delta",
                delta,
              }),
            onThinkingDelta: (delta, thinking) =>
              send({
                type: "thinking_delta",
                delta,
                durationMs: thinking.durationMs,
                wordCount: thinking.wordCount,
              }),
            parameters,
            provider,
            reasoningBudget: disableReasoning ? null : reasoningBudget,
            signal: abortSignal,
          });
        let completion: ChatCompletionResult;
        let abortedThinking: ChatThinking | null = null;

        if (toolDefinitions.length > 0) {
          const toolCompletion = await generateToolEnabledCompletion({
            agenticToolTurnLimit,
            abortSignal,
            allowSubAgents,
            apiKey,
            context,
            fallbackModel: {
              modelId,
              parameters,
              providerId: provider.id,
            },
            messages: [systemMessage, ...providerMessages],
            mode: systemPromptMode,
            modelId,
            onAssistantMessage: (message) =>
              send({
                type: "assistant_message",
                sessionId: session.id,
                message,
                providerId: provider.id,
                providerLabel: provider.label,
                modelId,
                thinking: message.thinking ?? null,
                title: session.title,
              }),
            onContentDelta: (delta) => {
              send({
                type: "content_delta",
                delta,
              });
            },
            onUserChoiceRequest: (request) =>
              send({
                type: "user_choice_request",
                request,
              }),
            onToolCall: (call) =>
              send({
                type: "tool_call",
                call,
              }),
            onSubAgentEvent: send,
            onThinkingDelta: (delta, thinking) =>
              send({
                type: "thinking_delta",
                delta,
                durationMs: thinking.durationMs,
                wordCount: thinking.wordCount,
              }),
            parameters,
            provider,
            reasoningBudget,
            session,
            toolDefinitions,
            toolSettings,
          });
          completion = toolCompletion;

          if (toolCompletion.content && !toolCompletion.contentStreamed) {
            send({
              type: "content_delta",
              delta: toolCompletion.content,
            });
          }
        } else {
          try {
            completion = await streamCompletion(false);
          } catch (caught) {
            if (!reasoningBudget || !(caught instanceof ReasoningBudgetExceededError)) {
              throw caught;
            }

            abortedThinking = caught.thinking ? { ...caught.thinking, cutOff: true } : null;
            completion = await streamCompletion(true);
          }

          completion = {
            ...completion,
            thinking: mergeChatThinking(abortedThinking, completion.thinking),
          };
        }

        const assistantMessage = context.chatMessages.createChatMessage({
          id: createId("msg"),
          sessionId: session.id,
          role: "assistant",
          content: completion.content,
          status: completion.status,
          thinking: completion.thinking,
          metrics: completion.metrics,
        });

        if (completion.status === "error") {
          send({
            type: "error",
            error: completion.content,
          });
          return;
        }

        send({
          type: "done",
          sessionId: session.id,
          message: assistantMessage,
          providerId: provider.id,
          providerLabel: provider.label,
          modelId,
          thinking: completion.thinking,
          title: session.title,
        });
      } catch (caught) {
        if (isChatRequestAbort(caught, abortSignal)) {
          return;
        }

        logToStdout("chat", "Chat stream failed.", {
          error: errorForLog(caught),
          modelId,
          providerId: provider.id,
          sessionId: session.id,
        });
        try {
          const error = messageFromUnknown(caught);

          context.chatMessages.createChatMessage({
            id: createId("msg"),
            sessionId: session.id,
            role: "assistant",
            content: error,
            status: "error",
          });

          send({
            type: "error",
            error,
          });
        } catch (sendCaught) {
          if (!isChatRequestAbort(sendCaught, abortSignal)) {
            throw sendCaught;
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // The client may have already closed the POST stream.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

class ChatRequestAbortedError extends Error {
  constructor() {
    super("Chat request was stopped.");
    this.name = "AbortError";
  }
}

function throwIfChatRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ChatRequestAbortedError();
  }
}

function isChatRequestAbort(caught: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }

  return (
    caught instanceof ChatRequestAbortedError ||
    (caught instanceof DOMException && caught.name === "AbortError") ||
    (caught instanceof Error && caught.name === "AbortError")
  );
}

export async function handleOrchestrationTimerFired(
  context: ServerContext,
  event: OrchestrationTimerFiredNotification,
): Promise<void> {
  const session = context.agentSessions.getAgentSession(event.sessionId);

  if (!session) {
    return;
  }

  const provider = context.getLlmProviders().find((item) => item.id === session.providerId);
  const userMessage = context.chatMessages.createChatMessage({
    id: createId("msg"),
    sessionId: session.id,
    role: "user",
    content: event.message,
  });

  publishAgentMessage({
    context,
    generated: {
      kind: "timer",
      ...(event.label ? { label: event.label } : {}),
      ...(event.lengthSeconds ? { lengthSeconds: event.lengthSeconds } : {}),
      timerId: event.timerId,
    },
    message: userMessage,
    modelId: session.modelId,
    sessionId: session.id,
  });

  if (!provider || !provider.enabled || !provider.configured) {
    publishBackgroundAssistantMessage({
      content: "The timer fired, but the saved model provider is not configured.",
      context,
      session,
    });
    return;
  }

  const providerDefinition = getLlmProvider(provider.id);
  const apiKey = providerDefinition?.credentialEnvVars
    .map((envVar) => context.secretEnv.mergedWithProcessEnv()[envVar])
    .find((value): value is string => Boolean(value));
  const mode = systemPromptModeForSessionType(session.type);
  const systemPrompt = systemPromptTemplateForMode(context, mode);
  const toolSettings = defaultChatToolSettings;
  const richFeatureSettings = context.richFeatures.getRichFeatureSettings();
  const mcpToolDefinitions = backgroundSafeToolDefinitions(
    context.mcp.getToolDefinitions(toolSettings),
  );
  const allowSubAgents = mode === "agentic" && session.type === "agentic";
  const toolDefinitions = chatToolDefinitionsForMode(mcpToolDefinitions, allowSubAgents);
  const agenticToolTurnLimit =
    mode === "agentic" && richFeatureSettings.agenticToolTurnLimitEnabled
      ? richFeatureSettings.agenticToolTurnLimit
      : null;
  const assistantMessageId = createId("msg");

  context.hub.publish({
    id: createId("evt"),
    type: "agent.message",
    createdAt: now(),
    messageId: assistantMessageId,
    modelId: session.modelId,
    role: "assistant",
    content: "",
    sessionId: session.id,
  });

  try {
    const completion = await generateToolEnabledCompletion({
      agenticToolTurnLimit,
      allowSubAgents,
      apiKey,
      context,
      fallbackModel: {
        modelId: session.modelId,
        parameters: session.parameters,
        providerId: provider.id,
      },
      messages: [
        {
          role: "system",
          content: renderChatSystemPrompt({
            context,
            session,
            systemPrompt,
            toolDefinitions,
          }),
        },
        ...context.chatMessages.listSessionMessages(session.id),
      ],
      mode,
      modelId: session.modelId,
      onAssistantMessage: (message) =>
        publishAgentMessage({
          context,
          message,
          modelId: session.modelId,
          sessionId: session.id,
        }),
      onContentDelta: (delta) =>
        context.hub.publish({
          id: createId("evt"),
          type: "agent.delta",
          createdAt: now(),
          delta,
          messageId: assistantMessageId,
          role: "assistant",
          sessionId: session.id,
        }),
      onSubAgentEvent: (subAgentEvent) => publishSubAgentStreamEvent(context, subAgentEvent),
      onThinkingDelta: () => undefined,
      onToolCall: () => undefined,
      onUserChoiceRequest: () => undefined,
      parameters: session.parameters,
      provider,
      reasoningBudget: null,
      session,
      toolDefinitions,
      toolSettings,
    });
    publishBackgroundAssistantMessage({
      content: completion.content,
      context,
      messageId: assistantMessageId,
      session,
      thinking: completion.thinking,
    });
  } catch (caught) {
    publishBackgroundAssistantMessage({
      content: `The timer fired, but the follow-up model turn failed: ${messageFromUnknown(caught)}`,
      context,
      messageId: assistantMessageId,
      session,
    });
  }
}

export async function runScheduledTask(
  context: ServerContext,
  task: ScheduledTaskSummary,
  trigger: ScheduledTaskRunTrigger,
): Promise<void> {
  const runId = createId("run");
  const run = context.scheduledTaskRuns.startRun({
    id: runId,
    taskId: task.id,
    trigger,
    allowOverlap: task.allowOverlap,
  });

  if (!run) {
    // Another run is already in progress and this task does not allow overlap.
    return;
  }

  const abortController = new AbortController();
  context.scheduledTaskRunControllers.set(runId, { controller: abortController, taskId: task.id });

  try {
    const provider = context.getLlmProviders().find((item) => item.id === task.providerId);

    if (!provider || !provider.enabled || !provider.configured) {
      context.scheduledTaskRuns.completeRun(runId, {
        status: "error",
        error: `Model provider "${task.providerId}" is not configured or enabled.`,
      });
      context.scheduledTasks.markLastRunAt(task.id, new Date().toISOString());
      publishScheduledTaskUpdated(context, task.id);
      return;
    }

    let rootSessionId = task.rootSessionId;

    if (!rootSessionId) {
      const rootSession = context.agentSessions.createAgentSession({
        id: createId("session"),
        type: "agentic",
        parentSessionId: null,
        title: `Scheduled task: ${task.name}`,
        providerId: task.providerId,
        modelId: task.modelId,
        parameters: task.parameters,
        workspacePath: task.workspacePath,
      });

      rootSessionId = rootSession.id;
      context.scheduledTasks.setRootSessionId(task.id, rootSessionId);
    }

    const subSession = context.agentSessions.createAgentSession({
      id: createId("session"),
      type: "sub-agent",
      parentSessionId: rootSessionId,
      title: subAgentTitle(task.prompt),
      providerId: task.providerId,
      modelId: task.modelId,
      parameters: task.parameters,
      workspacePath: task.workspacePath,
    });

    context.scheduledTaskRuns.attachSession(runId, subSession.id);

    const userMessage = context.chatMessages.createChatMessage({
      id: createId("msg"),
      sessionId: subSession.id,
      role: "user",
      content: task.prompt,
    });

    publishAgentMessage({
      context,
      message: userMessage,
      modelId: task.modelId,
      sessionId: subSession.id,
    });

    let filesystemWorkspacePath: string | null = null;

    try {
      filesystemWorkspacePath = task.workingDirectory
        ? await resolveScheduledTaskWorkingDirectory(task.workingDirectory)
        : null;
    } catch (caught) {
      const message = normalizeToolErrorMessage(caught);

      publishBackgroundAssistantMessage({
        content: `Scheduled task failed before it could start: ${message}`,
        context,
        session: subSession,
      });
      context.scheduledTaskRuns.completeRun(runId, { status: "error", error: message });
      context.scheduledTasks.markLastRunAt(task.id, new Date().toISOString());
      publishScheduledTaskUpdated(context, task.id);
      return;
    }

    const providerDefinition = getLlmProvider(provider.id);
    const apiKey = providerDefinition?.credentialEnvVars
      .map((envVar) => context.secretEnv.mergedWithProcessEnv()[envVar])
      .find((value): value is string => Boolean(value));
    const toolSettings = defaultChatToolSettings;
    const toolDefinitions = filterSubAgentToolDefinitions(
      context.mcp.getToolDefinitions(toolSettings),
      null,
    );
    const assistantMessageId = createId("msg");

    context.hub.publish({
      id: createId("evt"),
      type: "agent.message",
      createdAt: now(),
      messageId: assistantMessageId,
      modelId: task.modelId,
      role: "assistant",
      content: "",
      sessionId: subSession.id,
    });

    try {
      const completion = await generateToolEnabledCompletion({
        agenticToolTurnLimit: null,
        abortSignal: abortController.signal,
        allowSubAgents: false,
        apiKey,
        context,
        fallbackModel: {
          modelId: task.modelId,
          parameters: task.parameters,
          providerId: provider.id,
        },
        messages: [
          {
            role: "system",
            content: renderSubAgentSystemPrompt({
              context,
              filesystemWorkspacePath,
              toolDefinitions,
            }),
          },
          {
            role: "user",
            content: task.prompt,
          },
        ],
        filesystemWorkspacePath,
        mode: "agentic",
        modelId: task.modelId,
        onAssistantMessage: (message) =>
          publishAgentMessage({
            context,
            message,
            modelId: task.modelId,
            sessionId: subSession.id,
          }),
        onContentDelta: () => undefined,
        onSubAgentEvent: () => undefined,
        onThinkingDelta: () => undefined,
        onToolCall: () => undefined,
        onUserChoiceRequest: () => undefined,
        parameters: task.parameters,
        provider,
        reasoningBudget: null,
        session: subSession,
        toolDefinitions,
        toolSettings,
      });

      publishBackgroundAssistantMessage({
        content: completion.content,
        context,
        messageId: assistantMessageId,
        session: subSession,
        thinking: completion.thinking,
      });

      const completedAt = new Date().toISOString();

      context.scheduledTaskRuns.completeRun(runId, {
        status: "done",
        summary: summarizeScheduledTaskRun(completion.content),
      });
      context.scheduledTasks.markLastRunAt(task.id, completedAt);
      publishScheduledTaskUpdated(context, task.id);
    } catch (caught) {
      const stopped = isChatRequestAbort(caught, abortController.signal);
      const message = stopped ? "Stopped by user." : normalizeToolErrorMessage(caught);

      publishBackgroundAssistantMessage({
        content: stopped
          ? "Scheduled task run was stopped by user."
          : `The scheduled task fired, but the model turn failed: ${message}`,
        context,
        messageId: assistantMessageId,
        session: subSession,
      });

      const completedAt = new Date().toISOString();

      context.scheduledTaskRuns.completeRun(runId, { status: "error", error: message });
      context.scheduledTasks.markLastRunAt(task.id, completedAt);
      publishScheduledTaskUpdated(context, task.id);
    }
  } finally {
    context.scheduledTaskRunControllers.delete(runId);
  }
}

async function resolveScheduledTaskWorkingDirectory(workingDirectory: string): Promise<string> {
  if (!isAbsolute(workingDirectory)) {
    throw new Error("workingDirectory must be an absolute path.");
  }

  const resolvedPath = await realpath(workingDirectory);
  const dirStat = await stat(resolvedPath);

  if (!dirStat.isDirectory()) {
    throw new Error("workingDirectory must be a directory.");
  }

  return resolvedPath;
}

function summarizeScheduledTaskRun(content: string): string {
  const trimmed = content.trim();
  const maxLength = 2_000;

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function publishScheduledTaskUpdated(context: ServerContext, taskId: string): void {
  const task = context.scheduledTasks.getScheduledTask(taskId) ?? context.scheduledTasks.getGlobalScheduledTask(taskId);

  if (!task) {
    return;
  }

  const runs = context.scheduledTaskRuns.listRuns(taskId, 1);

  context.hub.publish({
    id: createId("evt"),
    type: "scheduled_task.updated",
    createdAt: now(),
    task,
    ...(runs[0] ? { run: runs[0] } : {}),
  });
}

function reasoningBudgetForRequest(
  settings: HistorySettingsSummary,
  provider: LlmProviderSummary,
  modelId: string,
): ReasoningBudgetLimit | null {
  if (!settings.limitReasoningBudget || isOpenAiModel(provider, modelId)) {
    return null;
  }

  return {
    maxDurationMs: settings.maxReasoningTimeSeconds * 1000,
    maxWords: settings.maxReasoningWords,
  };
}

function isOpenAiModel(provider: LlmProviderSummary, modelId: string): boolean {
  return provider.id === "openai" || modelId.toLowerCase().startsWith("openai/");
}

function prependReasoningBudgetRetryMessage(messages: ProviderChatMessage[]): ProviderChatMessage[] {
  return [
    {
      role: "assistant",
      content: reasoningBudgetRetryMessage,
    },
    ...messages,
  ];
}

function includeThinkingHistory(
  messages: ChatMessage[],
  persistedMessages: StoredChatMessage[],
): ProviderChatMessage[] {
  let persistedIndex = 0;

  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    const match = findNextPersistedAssistantMessage(
      persistedMessages,
      message.content,
      persistedIndex,
    );

    if (!match) {
      return message;
    }

    persistedIndex = match.index + 1;

    if (
      !match.message.thinking?.content.trim() &&
      !match.message.thinking?.encryptedContent?.trim()
    ) {
      return message;
    }

    return {
      ...message,
      thinkingHistory: thinkingHistoryForProvider(match.message.thinking),
    };
  });
}

function findNextPersistedAssistantMessage(
  persistedMessages: StoredChatMessage[],
  content: string,
  startIndex: number,
): { index: number; message: StoredChatMessage } | null {
  for (let index = startIndex; index < persistedMessages.length; index += 1) {
    const message = persistedMessages[index];

    if (!message || message.role !== "assistant") {
      continue;
    }

    if (message.content.trim() === content.trim()) {
      return { index, message };
    }
  }

  return null;
}

const thinkingCutOffSuffix = "\n\n... and that's enough reasoning for now. Let me respond.";

function thinkingHistoryForProvider(thinking: ChatThinking): ProviderThinkingHistory {
  const rawContent = thinking.content.trim();
  const contentWithSuffix = thinking.cutOff ? `${rawContent}${thinkingCutOffSuffix}` : rawContent;
  const thinkingContent = truncateThinkingHistory(contentWithSuffix);
  const encryptedContent = thinking.encryptedContent?.trim();

  return {
    ...(thinkingContent ? { content: thinkingContent } : {}),
    ...(encryptedContent ? { encryptedContent } : {}),
  };
}

function truncateThinkingHistory(value: string): string {
  if (value.length <= maxThinkingHistoryLength) {
    return value;
  }

  return `${value.slice(0, maxThinkingHistoryLength)}\n[thinking history truncated]`;
}

function resolveChatSession(
  request: NormalizedChatRequest,
  context: ServerContext,
): { ok: true; session: AgentSessionSummary } | { ok: false; error: string } {
  if (request.sessionId) {
    const existing = context.agentSessions.getAgentSession(request.sessionId);

    if (!existing) {
      return { ok: false, error: "Chat session does not exist." };
    }

    if (
      (request.providerId && request.providerId !== existing.providerId) ||
      (request.modelId && request.modelId !== existing.modelId)
    ) {
      return createChatSession(request, context);
    }

    return { ok: true, session: existing };
  }

  return createChatSession(request, context);
}

function createChatSession(
  request: NormalizedChatRequest,
  context: ServerContext,
): { ok: true; session: AgentSessionSummary } | { ok: false; error: string } {

  const profileId = defaultProfileIdForAgentSessionType(request.type);
  const profile = context.modelProfiles.getModelProfile(profileId);

  if (!profile) {
    return { ok: false, error: "Model profile is not configured." };
  }

  const providerId = request.providerId ?? profile.providerId;
  const modelId = request.modelId ?? profile.modelId;

  if (!getLlmProvider(providerId)) {
    return { ok: false, error: "Unknown LLM provider." };
  }

  if (modelId.length > maxModelLength) {
    return { ok: false, error: "modelId is too long." };
  }

  return {
    ok: true,
    session: context.agentSessions.createAgentSession({
      id: createId("session"),
      type: request.type,
      parentSessionId: null,
      title: null,
      providerId,
      modelId,
      parameters: profile.parameters,
    }),
  };
}

function scheduleChatTitleGeneration({
  context,
  messages,
  session,
}: {
  context: ServerContext;
  messages: ChatMessage[];
  session: AgentSessionSummary;
}): void {
  if (session.title || pendingTitleSessionIds.has(session.id)) {
    return;
  }

  pendingTitleSessionIds.add(session.id);

  void (async () => {
    try {
      const title = await generateConversationTitle(context, messages);

      if (!title) {
        return;
      }

      const updated = context.agentSessions.updateAgentSessionTitle(session.id, title);
      const persistedTitle = updated?.title ?? title;

      context.hub.publish({
        id: createId("evt"),
        type: "agent.session.title",
        createdAt: now(),
        sessionId: session.id,
        title: persistedTitle,
      });
    } catch {
      // Internal title generation should not affect the user-facing chat path.
    } finally {
      pendingTitleSessionIds.delete(session.id);
    }
  })();
}

interface NormalizedChatRequest {
  messages: ChatMessage[];
  modeOverride: SystemPromptMode | null;
  modelId: string | null;
  providerId: string | null;
  sessionId: string | null;
  toolSettings: ChatToolSettings;
  type: "conversation" | "agentic";
}

function validateChatRequest(
  body: ChatRequest | null,
): { ok: true; request: NormalizedChatRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Chat payload must be an object." };
  }

  if (body.type !== "conversation" && body.type !== "agentic") {
    return { ok: false, error: "type must be conversation or agentic." };
  }

  if (
    body.modeOverride !== undefined &&
    body.modeOverride !== "conversation" &&
    body.modeOverride !== "agentic"
  ) {
    return { ok: false, error: "modeOverride must be conversation or agentic." };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: "messages must be a non-empty array." };
  }

  if (body.messages.length > maxMessageCount) {
    return { ok: false, error: `messages may contain at most ${maxMessageCount} entries.` };
  }

  const messages: ChatMessage[] = [];

  for (const message of body.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { ok: false, error: "Each message must be an object." };
    }

    if (!["system", "user", "assistant"].includes(message.role)) {
      return { ok: false, error: "Message role must be system, user, or assistant." };
    }

    if (typeof message.content !== "string") {
      return { ok: false, error: "Message content is required." };
    }

    if (message.content.length > maxMessageLength) {
      return { ok: false, error: "Message content is too long." };
    }

    const attachmentValidation = validateChatAttachments(message.attachments);

    if (!attachmentValidation.ok) {
      return attachmentValidation;
    }

    if (!message.content.trim() && attachmentValidation.attachments.length === 0) {
      return { ok: false, error: "Message content or attachments are required." };
    }

    messages.push({
      role: message.role,
      content: message.content.trim(),
      attachments:
        attachmentValidation.attachments.length > 0 ? attachmentValidation.attachments : undefined,
    });
  }

  const toolSettings = validateToolSettings(body.tools);

  if (!toolSettings.ok) {
    return { ok: false, error: toolSettings.error };
  }

  return {
    ok: true,
    request: {
      messages,
      modeOverride: body.modeOverride ?? null,
      modelId: normalizeOptionalText(body.modelId),
      providerId: normalizeOptionalText(body.providerId),
      sessionId: normalizeOptionalText(body.sessionId),
      toolSettings: toolSettings.settings,
      type: body.type,
    },
  };
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type SubAgentStreamEvent = Extract<ChatStreamEvent, { type: `sub_agent.${string}` }>;

interface ToolEnabledCompletionResult extends ChatCompletionResult {
  contentStreamed: boolean;
  toolTurnCount: number;
}

async function generateToolEnabledCompletion({
  agenticToolTurnLimit,
  abortSignal,
  allowSubAgents,
  apiKey,
  context,
  fallbackModel,
  messages,
  filesystemWorkspacePath,
  mcpToolFilter,
  mode,
  modelId,
  onAssistantMessage,
  onContentDelta,
  onSubAgentEvent,
  onThinkingDelta,
  onUserChoiceRequest,
  onToolCall,
  parameters,
  provider,
  reasoningBudget,
  session,
  toolDefinitions,
  toolSettings,
}: {
  agenticToolTurnLimit: number | null;
  abortSignal?: AbortSignal;
  allowSubAgents: boolean;
  apiKey?: string;
  context: ServerContext;
  fallbackModel: ToolExecutionModelReference;
  messages: ProviderChatMessage[];
  filesystemWorkspacePath?: string | null;
  mcpToolFilter?: McpToolFilterOptions;
  mode: SystemPromptMode;
  modelId: string;
  onAssistantMessage(message: StoredChatMessage): void;
  onContentDelta(delta: string): void;
  onSubAgentEvent(event: SubAgentStreamEvent): void;
  onThinkingDelta(delta: string, thinking: ChatThinking): void;
  onUserChoiceRequest(request: ChatUserChoiceRequest): void;
  onToolCall(call: ChatToolCall): void;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  reasoningBudget: ReasoningBudgetLimit | null;
  session: AgentSessionSummary;
  toolDefinitions: LlmToolDefinition[];
  toolSettings: ChatToolSettings;
}): Promise<ToolEnabledCompletionResult> {
  const toolMessages = [...messages];
  const toolCalls: ChatToolCall[] = [];
  let currentBlockStartedAt = Date.now();
  let currentBlockToolCallStartIndex = 0;
  const maxConsecutiveToolFailures = 50;
  let accumulatedThinking: ChatThinking | null = null;
  let currentBlockThinking: ChatThinking | null = null;
  let pendingAfterThinkingToolCallIds: string[] = [];
  let currentBlockContentStreamed = false;
  let toolTurnCount = 0;
  let currentBlockToolRuntimeMs = 0;
  let providerToolResponseFailureCount = 0;
  const maxProviderToolResponseFailures = 3;
  const budgetMonitor = createReasoningBudgetMonitor(reasoningBudget, () => {});
  const throwIfAborted = () => throwIfChatRequestAborted(abortSignal);
  const currentBlockToolCalls = (): ChatToolCall[] =>
    toolCalls.slice(currentBlockToolCallStartIndex);
  const emitContentDelta = (delta: string): void => {
    currentBlockContentStreamed = true;
    onContentDelta(delta);
  };
  const resetCurrentAssistantBlock = (): void => {
    currentBlockStartedAt = Date.now();
    currentBlockToolCallStartIndex = toolCalls.length;
    currentBlockThinking = null;
    currentBlockToolRuntimeMs = 0;
    currentBlockContentStreamed = false;
    pendingAfterThinkingToolCallIds = [];
  };
  const currentBlockMergedThinking = (): ChatThinking | null =>
    mergeToolCallThinking(
      currentBlockThinking,
      currentBlockToolCalls(),
      currentBlockStartedAt,
      currentBlockToolRuntimeMs,
    );
  const emitIntermediateAssistantMessage = (content: string): void => {
    const message = context.chatMessages.createChatMessage({
      id: createId("msg"),
      sessionId: session.id,
      role: "assistant",
      content,
      thinking: currentBlockMergedThinking(),
    });

    onAssistantMessage(message);
    resetCurrentAssistantBlock();
  };

  const appendToolTurnThinking = (thinking: ChatThinking | null): ChatThinking | null => {
    const normalizedThinking = normalizeThinking(thinking);

    if (!normalizedThinking) {
      return currentBlockThinking;
    }

    const deltaPrefix = currentBlockThinking?.content.trim() ? "\n\n" : "";

    accumulatedThinking = mergeChatThinking(accumulatedThinking, normalizedThinking);
    currentBlockThinking = mergeChatThinking(currentBlockThinking, normalizedThinking);

    if (currentBlockThinking) {
      onThinkingDelta(`${deltaPrefix}${normalizedThinking.content}`, currentBlockThinking);
    }

    return currentBlockThinking;
  };

  const checkReasoningBudget = () => {
    if (budgetMonitor.exceeded) {
      throw new ReasoningBudgetExceededError(budgetMonitor.thinking);
    }

    if (!accumulatedThinking) {
      return;
    }

    budgetMonitor.check(accumulatedThinking);
  };

  const applyAfterThinkingToPendingToolCalls = (thinking: ChatThinking | null): void => {
    const pendingIds = pendingAfterThinkingToolCallIds;

    pendingAfterThinkingToolCallIds = [];

    const content = thinking?.content.trim();

    if (!content || pendingIds.length === 0) {
      return;
    }

    for (const toolCallId of pendingIds) {
      const existingCall = toolCalls.find((toolCall) => toolCall.id === toolCallId);

      if (!existingCall) {
        continue;
      }

      const updatedCall: ChatToolCall = {
        ...existingCall,
        thinkingAfter: appendThinkingTextBlock(existingCall.thinkingAfter, content),
      };

      replaceToolCall(toolCalls, updatedCall);
      onToolCall(updatedCall);
    }
  };

  const completeAfterReasoningBudgetExceeded = async (
    _caught: ReasoningBudgetExceededError,
  ): Promise<ToolEnabledCompletionResult> => {
    const budgetThinking = currentBlockMergedThinking();
    const budgetThinkingWithCutOff = budgetThinking ? { ...budgetThinking, cutOff: true } : null;

    logToStdout("chat", "Requesting direct answer after reasoning budget exceeded.", {
      modelId,
      providerId: provider.id,
      toolMessageCount: toolMessages.length,
    });

    try {
      const directCompletion = await generateChatCompletionWithTools({
        apiKey,
        disableReasoning: true,
        messages: [
          ...toolMessages,
          {
            role: "assistant",
            content: reasoningBudgetRetryMessage,
          },
        ],
        modelId,
        onContentDelta: emitContentDelta,
        parameters,
        provider,
        signal: abortSignal,
        stream: true,
        tools: [],
      });
      const mergedThinking = mergeChatThinking(
        budgetThinkingWithCutOff,
        normalizeThinking(directCompletion.thinking),
      );

      return {
        content: directCompletion.content,
        contentStreamed: currentBlockContentStreamed,
        thinking: mergeToolCallThinking(
          mergedThinking,
          currentBlockToolCalls(),
          currentBlockStartedAt,
        ),
        toolTurnCount,
      };
    } catch (retryCaught) {
      if (isChatRequestAbort(retryCaught, abortSignal)) {
        throw retryCaught;
      }

      logToStdout("chat", "Reasoning-budget direct answer failed after tool use.", {
        error: errorForLog(retryCaught),
        modelId,
        providerId: provider.id,
        toolCallCount: toolCalls.length,
      });

      return {
        content: renderToolReasoningBudgetFailureMessage(messageFromUnknown(retryCaught)),
        contentStreamed: currentBlockContentStreamed,
        thinking: budgetThinkingWithCutOff,
        toolTurnCount,
      };
    }
  };

  const executeSubAgentToolCall = async ({
    thinkingBefore,
    toolCall,
    turn,
  }: {
    thinkingBefore: string | undefined;
    toolCall: ChatCompletionToolResult["toolCalls"][number];
    turn: number;
  }): Promise<{ observation: ProviderChatMessage; visibleToolCallId: string }> => {
    const startedAt = new Date().toISOString();
    const visibleToolCallId = createId("tool");

    if (!allowSubAgents || mode !== "agentic") {
      const failedCall: ChatToolCall = {
        args: toolCall.arguments,
        completedAt: startedAt,
        error: "Sub-agent spawning is only available during agentic turns.",
        id: visibleToolCallId,
        startedAt,
        status: "error",
        ...(thinkingBefore ? { thinkingBefore } : {}),
        title: "Spawn sub-agent",
        turn,
        toolId: spawnSubAgentToolName,
      };

      toolCalls.push(failedCall);
      onToolCall(failedCall);

      return {
        observation: {
          role: "tool",
          content: renderToolErrorObservation(failedCall, failedCall.error ?? ""),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        visibleToolCallId,
      };
    }

    let request: SubAgentSpawnRequest;

    try {
      request = normalizeSubAgentSpawnRequest(toolCall.arguments);
    } catch (caught) {
      if (isChatRequestAbort(caught, abortSignal)) {
        throw caught;
      }

      const message = normalizeToolErrorMessage(caught);
      const failedCall: ChatToolCall = {
        args: toolCall.arguments,
        completedAt: startedAt,
        error: message,
        id: visibleToolCallId,
        startedAt,
        status: "error",
        ...(thinkingBefore ? { thinkingBefore } : {}),
        title: "Spawn sub-agent",
        turn,
        toolId: spawnSubAgentToolName,
      };

      toolCalls.push(failedCall);
      onToolCall(failedCall);

      return {
        observation: {
          role: "tool",
          content: renderToolErrorObservation(failedCall, message),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        visibleToolCallId,
      };
    }

    let filesystemWorkspacePath: string | null;
    let subAgentMcpToolFilter: McpToolFilterOptions | undefined;

    try {
      filesystemWorkspacePath = await resolveSubAgentFilesystemWorkspacePath(
        context,
        request.workspacePath,
      );
      subAgentMcpToolFilter = subAgentMcpFilter(context, request.mcpServers);
    } catch (caught) {
      if (isChatRequestAbort(caught, abortSignal)) {
        throw caught;
      }

      const message = normalizeToolErrorMessage(caught);
      const failedCall: ChatToolCall = {
        args: toolCall.arguments,
        completedAt: startedAt,
        error: message,
        id: visibleToolCallId,
        startedAt,
        status: "error",
        ...(thinkingBefore ? { thinkingBefore } : {}),
        title: "Spawn sub-agent",
        turn,
        toolId: spawnSubAgentToolName,
      };

      toolCalls.push(failedCall);
      onToolCall(failedCall);

      return {
        observation: {
          role: "tool",
          content: renderToolErrorObservation(failedCall, message),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        visibleToolCallId,
      };
    }

    const subSession = context.agentSessions.createAgentSession({
      id: createId("session"),
      type: "sub-agent",
      parentSessionId: session.id,
      title: subAgentTitle(request.task),
      providerId: provider.id,
      modelId,
      parameters,
      workspacePath: session.workspacePath,
    });
    const userMessage = context.chatMessages.createChatMessage({
      id: createId("msg"),
      sessionId: subSession.id,
      role: "user",
      content: request.task,
    });
    const subAgent: ChatSubAgentReference = {
      modelId,
      parentSessionId: session.id,
      startedAt,
      status: "running",
      subSessionId: subSession.id,
      task: request.task,
    };
    const visibleCall: ChatToolCall = {
      args: toolCall.arguments,
      id: visibleToolCallId,
      startedAt,
      status: "running",
      subAgent,
      ...(thinkingBefore ? { thinkingBefore } : {}),
      title: subAgentToolTitle(request.task),
      turn,
      toolId: spawnSubAgentToolName,
    };
    const emitSubAgentEvent = (event: SubAgentStreamEvent): void => {
      try {
        onSubAgentEvent(event);
      } catch {
        // The parent POST stream may already be closed while an async sub-agent continues.
      }
    };
    const emitToolCall = (call: ChatToolCall): void => {
      try {
        onToolCall(call);
      } catch {
        // The parent POST stream may already be closed while an async sub-agent continues.
      }
    };

    publishSubAgentSpawned(context, subAgent);
    emitSubAgentEvent({
      type: "sub_agent.spawned",
      message: userMessage,
      modelId,
      parentSessionId: session.id,
      startedAt,
      subSessionId: subSession.id,
      task: request.task,
    });
    publishSubAgentStatus(context, subAgent);
    emitSubAgentEvent({
      type: "sub_agent.status",
      status: "running",
      subSessionId: subSession.id,
    });
    toolCalls.push(visibleCall);
    emitToolCall(visibleCall);

    const runSubAgent = async (): Promise<void> => {
      try {
      const subStartedAt = Date.now();
      const subToolDefinitions = filterSubAgentToolDefinitions(
        context.mcp.getToolDefinitions(toolSettings, subAgentMcpToolFilter),
        request.tools,
      );
      const subSystemMessage: ChatMessage = {
        role: "system",
        content: renderSubAgentSystemPrompt({
          context,
          filesystemWorkspacePath,
          toolDefinitions: subToolDefinitions,
        }),
      };
      const completion = await generateToolEnabledCompletion({
        agenticToolTurnLimit,
        allowSubAgents: false,
        apiKey,
        context,
        fallbackModel,
        messages: [
          subSystemMessage,
          {
            role: "user",
            content: request.task,
          },
        ],
        filesystemWorkspacePath,
        mcpToolFilter: subAgentMcpToolFilter,
        mode: "agentic",
        modelId,
        onAssistantMessage: (message) =>
          emitSubAgentEvent({
            type: "sub_agent.message",
            message,
            modelId,
            subSessionId: subSession.id,
          }),
        onContentDelta: (delta) =>
          emitSubAgentEvent({
            type: "sub_agent.delta",
            delta,
            modelId,
            subSessionId: subSession.id,
          }),
        onSubAgentEvent: emitSubAgentEvent,
        onThinkingDelta: (delta, thinking) =>
          emitSubAgentEvent({
            type: "sub_agent.thinking_delta",
            delta,
            durationMs: thinking.durationMs,
            subSessionId: subSession.id,
            wordCount: thinking.wordCount,
          }),
        onToolCall: (call) =>
          emitSubAgentEvent({
            type: "sub_agent.tool_call",
            call,
            subSessionId: subSession.id,
          }),
        onUserChoiceRequest,
        parameters,
        provider,
        reasoningBudget,
        session: subSession,
        toolDefinitions: subToolDefinitions,
        toolSettings,
      });
      const assistantMessage = context.chatMessages.createChatMessage({
        id: createId("msg"),
        sessionId: subSession.id,
        role: "assistant",
        content: completion.content,
        thinking: completion.thinking,
        metrics: completion.metrics,
      });
      const completedAt = new Date().toISOString();
      const elapsedMs = Date.now() - subStartedAt;
      const completedSubAgent: ChatSubAgentReference = {
        ...subAgent,
        completedAt,
        elapsedMs,
        status: "done",
        toolTurnCount: completion.toolTurnCount,
      };
      const result =
        "Sub-agent completed. Open the sub-agent inspection view for its transcript and output.";
      const completedCall: ChatToolCall = {
        ...visibleCall,
        completedAt,
        result,
        status: "completed",
        subAgent: completedSubAgent,
      };

      emitSubAgentEvent({
        type: "sub_agent.message",
        message: assistantMessage,
        modelId,
        subSessionId: subSession.id,
      });
      publishSubAgentStatus(context, completedSubAgent);
      emitSubAgentEvent({
        type: "sub_agent.status",
        completedAt,
        elapsedMs,
        status: "done",
        subSessionId: subSession.id,
        toolTurnCount: completion.toolTurnCount,
      });
      replaceToolCall(toolCalls, completedCall);
      emitToolCall(completedCall);

      return;
    } catch (caught) {
      const completedAt = new Date().toISOString();
      const message = normalizeToolErrorMessage(caught);
      const failedSubAgent: ChatSubAgentReference = {
        ...subAgent,
        completedAt,
        elapsedMs: Date.now() - new Date(startedAt).getTime(),
        status: "error",
      };
      const failedCall: ChatToolCall = {
        ...visibleCall,
        completedAt,
        error: message,
        status: "error",
        subAgent: failedSubAgent,
      };

      logToStdout("chat", "Sub-agent execution failed.", {
        error: errorForLog(caught),
        modelId,
        providerId: provider.id,
        subSessionId: subSession.id,
        turn,
      });
      publishSubAgentStatus(context, failedSubAgent);
      emitSubAgentEvent({
        type: "sub_agent.status",
        completedAt,
        elapsedMs: failedSubAgent.elapsedMs,
        status: "error",
        subSessionId: subSession.id,
      });
      replaceToolCall(toolCalls, failedCall);
      emitToolCall(failedCall);

      return;
    }
    };

    const subAgentTask = runSubAgent().finally(() => {
      context.subAgentTasks.delete(subSession.id);
    });

    context.subAgentTasks.set(subSession.id, subAgentTask);

    return {
      observation: {
        role: "tool",
        content: formatToonToolResult(spawnSubAgentToolName, {
          status: "running",
          subSessionId: subSession.id,
        }),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      },
      visibleToolCallId,
    };
  };

  const executeProviderToolCall = async (
    toolCall: ChatCompletionToolResult["toolCalls"][number],
    thinkingBefore: string | undefined,
    turn: number,
  ): Promise<{ observation: ProviderChatMessage; visibleToolCallId: string }> => {
    if (toolCall.name === spawnSubAgentToolName) {
      return executeSubAgentToolCall({
        thinkingBefore,
        toolCall,
        turn,
      });
    }

    const binding = context.mcp.resolveTool(toolCall.name, toolSettings, mcpToolFilter);

    if (!binding) {
      const completedAt = new Date().toISOString();
      const visibleToolCallId = createId("tool");
      const failedCall: ChatToolCall = {
        args: toolCall.arguments,
        completedAt,
        error:
          "This MCP tool is not available. It may be disabled, disconnected, or no longer exposed by its server.",
        id: visibleToolCallId,
        startedAt: completedAt,
        status: "error",
        ...(thinkingBefore ? { thinkingBefore } : {}),
        title: unknownToolTitle(toolCall.name),
        turn,
        toolId: toolCall.name || "unknown_tool",
      };

      logToStdout("chat", "Provider requested an unknown MCP tool.", {
        modelId,
        providerId: provider.id,
        toolArguments: toolCall.arguments,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        turn,
      });
      toolCalls.push(failedCall);
      onToolCall(failedCall);

      return {
        observation: {
          role: "tool",
          content: renderToolErrorObservation(
            failedCall,
            failedCall.error ?? "Unknown MCP tool.",
          ),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        visibleToolCallId,
      };
    }

    const startedAt = new Date().toISOString();
    const visibleCall: ChatToolCall = {
      args: toolCall.arguments,
      id: createId("tool"),
      startedAt,
      status: "running",
      ...(thinkingBefore ? { thinkingBefore } : {}),
      title: mcpToolTitle(binding, toolCall.arguments),
      turn,
      toolId: binding.definition.name,
    };

    toolCalls.push(visibleCall);
    onToolCall(visibleCall);

    const applyToolProgress = (progress: ChatToolCallProgress): void => {
      const currentCall = toolCalls.find((call) => call.id === visibleCall.id) ?? visibleCall;

      if (currentCall.status !== "running") {
        return;
      }

      const updatedCall: ChatToolCall = {
        ...currentCall,
        progress,
      };

      replaceToolCall(toolCalls, updatedCall);
      onToolCall(updatedCall);
    };
    const applyCommandExecution = (commandExecution: ChatCommandExecutionReference): void => {
      const currentCall = toolCalls.find((call) => call.id === visibleCall.id) ?? visibleCall;

      if (currentCall.status !== "running") {
        return;
      }

      const updatedCall: ChatToolCall = {
        ...currentCall,
        commandExecution,
      };

      replaceToolCall(toolCalls, updatedCall);
      onToolCall(updatedCall);
    };

    try {
      const commandRunnerResult = isCommandRunnerToolBinding(binding)
        ? await executeCommandRunnerTool({
            args: toolCall.arguments,
            commandExecutionId: visibleCall.id,
            context,
            fallbackModel,
            intent: commandIntentFromMessages({
              messages: toolMessages,
              session,
            }),
            onCommandExecutionStarted: applyCommandExecution,
            onProgress: applyToolProgress,
            onUserChoiceRequest,
            session,
            signal: abortSignal,
            toolName: binding.toolName as Parameters<typeof executeCommandRunnerTool>[0]["toolName"],
          })
        : null;
      const rawResult = commandRunnerResult
        ? commandRunnerResult.result
        : isAskUserChoiceToolBinding(binding)
          ? await executeUserChoiceTool({
              args: toolCall.arguments,
              context,
              onUserChoiceRequest,
              signal: abortSignal,
            })
          : isRequestDirectoryAccessToolBinding(binding)
            ? await executeDirectoryAccessRequestTool({
                args: toolCall.arguments,
                context,
                modelId,
                onUserChoiceRequest,
                signal: abortSignal,
                session,
              })
            : isEditMcpConfigToolBinding(binding)
              ? await executeMcpConfigEditApprovalTool({
                  args: toolCall.arguments,
                  context,
                  onUserChoiceRequest,
                  signal: abortSignal,
                })
              : isScheduledTaskGlobalAccessToolBinding(binding)
                ? await executeScheduledTaskGlobalAccessRequestTool({
                    args: toolCall.arguments,
                    context,
                    onUserChoiceRequest,
                    signal: abortSignal,
                  })
                : await context.mcp.callTool({
                    args: toolCall.arguments,
                    binding,
                    meta: mcpToolMeta({
                      binding,
                      fallbackModel,
                      filesystemWorkspacePath,
                      mcpSettings: context.mcpSettings.getMcpSettings(),
                      sessionId: session.id,
                      toolSettings,
                    }),
                    onProgress: applyToolProgress,
                    signal: abortSignal,
                  });
      const imageResult = toolResultImageData(rawResult);
      const result = truncateToolObservation(rawResult, maxToolObservationLength, "tool result");
      const latestVisibleCall =
        toolCalls.find((call) => call.id === visibleCall.id) ?? visibleCall;
      const completedCall: ChatToolCall = {
        ...latestVisibleCall,
        completedAt: new Date().toISOString(),
        ...(imageResult ? { imageResult } : {}),
        result,
        ...(commandRunnerResult?.security
          ? { security: { commandRunner: commandRunnerResult.security } }
          : {}),
        status: "completed",
        ...(commandRunnerResult?.commandExecution
          ? { commandExecution: commandRunnerResult.commandExecution }
          : {}),
        ...(commandRunnerResult?.terminal ? { terminal: commandRunnerResult.terminal } : {}),
      };

      replaceToolCall(toolCalls, completedCall);
      onToolCall(completedCall);

      return {
        observation: {
          role: "tool",
          content: result,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        visibleToolCallId: visibleCall.id,
      };
    } catch (caught) {
      if (isChatRequestAbort(caught, abortSignal)) {
        throw caught;
      }

      const message = normalizeToolErrorMessage(caught);
      const commandRunnerSecurity = isCommandRunnerToolBinding(binding)
        ? commandRunnerToolSecurityFromError(caught)
        : null;
      const latestVisibleCall =
        toolCalls.find((call) => call.id === visibleCall.id) ?? visibleCall;
      const failedCall: ChatToolCall = {
        ...latestVisibleCall,
        completedAt: new Date().toISOString(),
        error: message,
        ...(commandRunnerSecurity ? { security: { commandRunner: commandRunnerSecurity } } : {}),
        status: "error",
      };

      logToStdout("chat", "Chat tool call failed.", {
        args: toolCall.arguments,
        error: errorForLog(caught),
        mcpServerId: binding.serverId,
        mcpToolName: binding.toolName,
        modelId,
        providerId: provider.id,
        title: visibleCall.title,
        toolCallId: toolCall.id,
        toolId: visibleCall.toolId,
        toolName: toolCall.name,
        turn,
      });
      replaceToolCall(toolCalls, failedCall);
      onToolCall(failedCall);

      return {
        observation: {
          role: "tool",
          content: renderToolErrorObservation(failedCall, message),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        visibleToolCallId: visibleCall.id,
      };
    }
  };

  const executeProviderToolCallsSequentially = async (
    providerToolCalls: ChatCompletionToolResult["toolCalls"],
    thinkingBefore: string | undefined,
    turn: number,
  ): Promise<Array<{ observation: ProviderChatMessage; visibleToolCallId: string }>> => {
    const results: Array<{ observation: ProviderChatMessage; visibleToolCallId: string }> = [];

    for (const providerToolCall of providerToolCalls) {
      throwIfAborted();
      results.push(await executeProviderToolCall(providerToolCall, thinkingBefore, turn));
    }

    return results;
  };

  try {
    while (true) {
      throwIfAborted();
      let completion: ChatCompletionToolResult;
      const nextTurn = toolTurnCount + 1;

      try {
        completion = await generateChatCompletionWithTools({
          apiKey,
          messages: toolMessages,
          modelId,
          onContentDelta: emitContentDelta,
          parameters,
          provider,
          signal: abortSignal,
          stream: toolCalls.length > 0,
          tools: toolDefinitions,
        });
      } catch (caught) {
        if (isChatRequestAbort(caught, abortSignal)) {
          throw caught;
        }

        providerToolResponseFailureCount += 1;

        logToStdout("chat", "Tool-enabled model completion failed.", {
          error: errorForLog(caught),
          failureCount: providerToolResponseFailureCount,
          maxProviderToolResponseFailures,
          modelId,
          providerId: provider.id,
          toolCallCount: toolCalls.length,
          turn: nextTurn,
        });

        if (providerToolResponseFailureCount < maxProviderToolResponseFailures) {
          toolMessages.push({
            role: "user",
            content: renderToolCompletionFailureObservation(
              messageFromUnknown(caught),
              providerToolResponseFailureCount,
              maxProviderToolResponseFailures,
            ),
          });
          continue;
        }

        return {
          content: renderToolCompletionFailureMessage(messageFromUnknown(caught)),
          contentStreamed: currentBlockContentStreamed,
          thinking: currentBlockMergedThinking(),
          toolTurnCount,
        };
      }

      providerToolResponseFailureCount = 0;
      const turnThinking = normalizeThinking(completion.thinking);
      const hasNormalFinalResponse =
        completion.toolCalls.length === 0 && completion.content.trim().length > 0;

      throwIfAborted();
      appendToolTurnThinking(turnThinking);
      if (!hasNormalFinalResponse) {
        applyAfterThinkingToPendingToolCalls(turnThinking);
      }

      try {
        checkReasoningBudget();
      } catch (caught) {
        if (caught instanceof ReasoningBudgetExceededError) {
          return await completeAfterReasoningBudgetExceeded(caught);
        }

        throw caught;
      }

      if (completion.toolCalls.length === 0) {
        return {
          content: completion.content,
          contentStreamed: currentBlockContentStreamed,
          metrics: completion.metrics,
          thinking: currentBlockMergedThinking(),
          toolTurnCount,
        };
      }

      toolMessages.push({
        role: "assistant",
        content: completion.content,
        toolCalls: completion.toolCalls,
      });

      const thinkingBefore = turnThinking?.content;
      const toolBatchStartedAt = Date.now();
      const results = completion.toolCalls.some(
        (toolCall) => toolCall.name === spawnSubAgentToolName,
      )
        ? await executeProviderToolCallsSequentially(
            completion.toolCalls,
            thinkingBefore,
            nextTurn,
          )
        : await Promise.all(
            completion.toolCalls.map((toolCall) =>
              executeProviderToolCall(toolCall, thinkingBefore, nextTurn),
            ),
          );
      const toolBatchDurationMs = Date.now() - toolBatchStartedAt;

      throwIfAborted();
      toolTurnCount += 1;
      currentBlockToolRuntimeMs += toolBatchDurationMs;
      toolMessages.push(...results.map((result) => result.observation));
      if (completion.content.trim().length > 0) {
        emitIntermediateAssistantMessage(completion.content);
      } else {
        pendingAfterThinkingToolCallIds = results.map((result) => result.visibleToolCallId);
      }

      try {
        budgetMonitor.chargeElapsed(toolBatchDurationMs);
      } catch (caught) {
        if (caught instanceof ReasoningBudgetExceededError) {
          return await completeAfterReasoningBudgetExceeded(caught);
        }

        throw caught;
      }

      if (shouldStopAfterContinuousToolFailures(toolCalls, maxConsecutiveToolFailures)) {
        logToStdout("chat", "Chat tool calls reached the consecutive failure limit.", {
          failedToolCalls: trailingFailedToolCalls(toolCalls).map((toolCall) => ({
            error: toolCall.error,
            title: toolCall.title,
            toolId: toolCall.toolId,
          })),
          maxConsecutiveToolFailures,
          modelId,
          providerId: provider.id,
          turn: nextTurn,
        });

        return {
          content: renderFailedToolCallsMessage(toolCalls, maxConsecutiveToolFailures),
          contentStreamed: currentBlockContentStreamed,
          thinking: currentBlockMergedThinking(),
          toolTurnCount,
        };
      }

      if (agenticToolTurnLimit !== null && toolTurnCount >= agenticToolTurnLimit) {
        logToStdout("chat", "Agentic tool use reached the configured turn limit.", {
          agenticToolTurnLimit,
          modelId,
          providerId: provider.id,
          toolCallCount: toolCalls.length,
        });

        return {
          content: renderToolTurnLimitMessage(agenticToolTurnLimit),
          contentStreamed: currentBlockContentStreamed,
          thinking: currentBlockMergedThinking(),
          toolTurnCount,
        };
      }
    }
  } catch (caught) {
    if (isChatRequestAbort(caught, abortSignal)) {
      throw caught;
    }

    if (caught instanceof ReasoningBudgetExceededError) {
      return await completeAfterReasoningBudgetExceeded(caught);
    }

    return {
      content: messageFromUnknown(caught),
      contentStreamed: currentBlockContentStreamed,
      status: "error",
      thinking: currentBlockMergedThinking(),
      toolTurnCount,
    };
  } finally {
    budgetMonitor.dispose();
  }
}

interface SubAgentSpawnRequest {
  mcpServers: string[] | null;
  task: string;
  tools: string[] | null;
  workspacePath: string | null;
}

function normalizeSubAgentSpawnRequest(args: Record<string, unknown>): SubAgentSpawnRequest {
  const task = typeof args.task === "string" ? args.task.trim() : "";

  if (!task) {
    throw new Error("task is required.");
  }

  if (task.length > maxSubAgentTaskLength) {
    throw new Error("task is too long.");
  }

  if (args.tools === undefined || args.tools === null) {
    return {
      mcpServers: normalizeOptionalStringAllowlist(args.mcpServers, "mcpServers"),
      task,
      tools: null,
      workspacePath: optionalStringArg(args, "workspacePath", maxSubAgentWorkspacePathLength),
    };
  }

  return {
    mcpServers: normalizeOptionalStringAllowlist(args.mcpServers, "mcpServers"),
    task,
    tools: normalizeOptionalStringAllowlist(args.tools, "tools") ?? [],
    workspacePath: optionalStringArg(args, "workspacePath", maxSubAgentWorkspacePathLength),
  };
}

function optionalStringArg(
  args: Record<string, unknown>,
  name: string,
  maxLength: number,
): string | null {
  const value = args[name];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${name} is too long.`);
  }

  return trimmed || null;
}

function normalizeOptionalStringAllowlist(
  value: unknown,
  name: string,
): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings.`);
  }

  if (value.length > maxSubAgentToolAllowlist) {
    throw new Error(`${name} may include at most ${maxSubAgentToolAllowlist} entries.`);
  }

  return [
    ...new Set(
      value.map((item, index) => {
        if (typeof item !== "string") {
          throw new Error(`${name}[${index}] must be a string.`);
        }

        return item.trim();
      }),
    ),
  ].filter(Boolean);
}

function filterSubAgentToolDefinitions(
  toolDefinitions: LlmToolDefinition[],
  allowlist: string[] | null,
): LlmToolDefinition[] {
  const safeToolDefinitions = excludeSubAgentSpawnTool(backgroundSafeToolDefinitions(toolDefinitions));

  if (!allowlist) {
    return safeToolDefinitions;
  }

  const allowed = new Set(allowlist);
  const available = new Set(safeToolDefinitions.map((tool) => tool.name));
  const unavailable = allowlist.filter((toolName) => !available.has(toolName));

  if (unavailable.length > 0) {
    throw new Error(`Sub-agent tool is not available: ${unavailable[0]}`);
  }

  return safeToolDefinitions.filter((tool) => allowed.has(tool.name));
}

function subAgentMcpFilter(
  context: ServerContext,
  mcpServers: string[] | null,
): McpToolFilterOptions | undefined {
  if (!mcpServers) {
    return undefined;
  }

  const connectedServerIds = new Set(
    context.mcp.summary.servers
      .filter((server) => server.connected)
      .map((server) => server.serverId),
  );
  const unknown = mcpServers.filter((serverId) => !connectedServerIds.has(serverId));

  if (unknown.length > 0) {
    throw new Error(`Sub-agent MCP server is not connected: ${unknown[0]}`);
  }

  return { allowedServerIds: mcpServers };
}

async function resolveSubAgentFilesystemWorkspacePath(
  context: ServerContext,
  workspacePath: string | null,
): Promise<string | null> {
  if (!workspacePath) {
    return null;
  }

  if (!isAbsolute(workspacePath)) {
    throw new Error("workspacePath must be an absolute path.");
  }

  const resolvedWorkspacePath = await realpath(workspacePath);
  const workspaceStat = await stat(resolvedWorkspacePath);

  if (!workspaceStat.isDirectory()) {
    throw new Error("workspacePath must be a directory.");
  }

  const grantedDirectories = await activeFileAccessGrantRoots(context);
  const matchingRoot = mostSpecificContainingFileAccessRoot(
    grantedDirectories,
    resolvedWorkspacePath,
  );

  if (!matchingRoot || matchingRoot.readOnly) {
    throw new Error("workspacePath must be inside the parent session's active writable file-access grants.");
  }

  return resolvedWorkspacePath;
}

async function activeFileAccessGrantRoots(
  context: ServerContext,
): Promise<Array<{ path: string; readOnly: boolean }>> {
  const grants = context.filesystemGrants
    .listGrantsForContext(context.options.conversationWorkspacePath)
    .map((grant) => ({
      path: grant.directoryPath,
      readOnly: grant.readOnly,
    }));
  const candidates = [
    ...(context.options.conversationWorkspacePath
      ? [{ path: context.options.conversationWorkspacePath, readOnly: false }]
      : []),
    ...grants,
  ];
  const resolved: Array<{ path: string; readOnly: boolean }> = [];

  for (const candidate of candidates) {
    try {
      resolved.push({
        path: await realpath(candidate.path),
        readOnly: candidate.readOnly,
      });
    } catch {
      // Ignore stale grants while validating a requested sub-agent root.
    }
  }

  return resolved;
}

function mostSpecificContainingFileAccessRoot(
  roots: Array<{ path: string; readOnly: boolean }>,
  targetPath: string,
): { path: string; readOnly: boolean } | null {
  const matchingRoots = roots.filter((root) => isPathWithin(root.path, targetPath));

  if (matchingRoots.length === 0) {
    return null;
  }

  return matchingRoots.sort(
    (left, right) => comparablePath(right.path).length - comparablePath(left.path).length,
  )[0] ?? null;
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(comparablePath(rootPath), comparablePath(targetPath));

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function comparablePath(path: string): string {
  const normalized = resolve(path);

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function subAgentTitle(task: string): string {
  return `Sub-agent: ${truncateErrorLine(task)}`;
}

function subAgentToolTitle(task: string): string {
  return `Sub-agent: ${truncateErrorLine(task)}`;
}

function publishSubAgentSpawned(
  context: ServerContext,
  subAgent: ChatSubAgentReference,
): void {
  context.hub.publish({
    id: createId("evt"),
    type: "sub_agent.spawned",
    createdAt: now(),
    modelId: subAgent.modelId ?? "",
    parentSessionId: subAgent.parentSessionId,
    startedAt: subAgent.startedAt,
    subSessionId: subAgent.subSessionId,
    task: subAgent.task,
  });
}

function publishSubAgentStatus(
  context: ServerContext,
  subAgent: ChatSubAgentReference,
): void {
  context.hub.publish({
    id: createId("evt"),
    type: "sub_agent.status",
    createdAt: now(),
    ...(subAgent.completedAt ? { completedAt: subAgent.completedAt } : {}),
    ...(typeof subAgent.elapsedMs === "number" ? { elapsedMs: subAgent.elapsedMs } : {}),
    status: subAgent.status,
    subSessionId: subAgent.subSessionId,
    ...(typeof subAgent.toolTurnCount === "number"
      ? { toolTurnCount: subAgent.toolTurnCount }
      : {}),
  });
}

function publishSubAgentStreamEvent(
  context: ServerContext,
  event: SubAgentStreamEvent,
): void {
  if (event.type === "sub_agent.spawned") {
    context.hub.publish({
      id: createId("evt"),
      type: "sub_agent.spawned",
      createdAt: now(),
      modelId: event.modelId,
      parentSessionId: event.parentSessionId,
      startedAt: event.startedAt,
      subSessionId: event.subSessionId,
      task: event.task,
    });
    return;
  }

  if (event.type === "sub_agent.status") {
    context.hub.publish({
      id: createId("evt"),
      type: "sub_agent.status",
      createdAt: now(),
      ...(event.completedAt ? { completedAt: event.completedAt } : {}),
      ...(typeof event.elapsedMs === "number" ? { elapsedMs: event.elapsedMs } : {}),
      status: event.status,
      subSessionId: event.subSessionId,
      ...(typeof event.toolTurnCount === "number" ? { toolTurnCount: event.toolTurnCount } : {}),
    });
  }
}

function publishAgentMessage({
  context,
  generated,
  message,
  modelId,
  sessionId,
}: {
  context: ServerContext;
  generated?: ChatGeneratedMessageMetadata;
  message: StoredChatMessage;
  modelId?: string;
  sessionId: string;
}): void {
  context.hub.publish({
    id: createId("evt"),
    type: "agent.message",
    createdAt: now(),
    content: message.content,
    ...(generated ? { generated } : {}),
    message,
    messageId: message.id,
    ...(modelId ? { modelId } : {}),
    role: message.role,
    sessionId,
  });
}

function publishBackgroundAssistantMessage({
  content,
  context,
  messageId = createId("msg"),
  session,
  thinking = null,
}: {
  content: string;
  context: ServerContext;
  messageId?: string;
  session: AgentSessionSummary;
  thinking?: ChatThinking | null;
}): void {
  const message = context.chatMessages.createChatMessage({
    id: messageId,
    sessionId: session.id,
    role: "assistant",
    content,
    thinking,
  });

  publishAgentMessage({
    context,
    message,
    modelId: session.modelId,
    sessionId: session.id,
  });
  context.hub.publish({
    id: createId("evt"),
    type: "agent.done",
    createdAt: now(),
    message,
    messageId: message.id,
    sessionId: session.id,
  });
}

function chatToolDefinitionsForMode(
  mcpToolDefinitions: LlmToolDefinition[],
  allowSubAgents: boolean,
): LlmToolDefinition[] {
  return allowSubAgents ? mcpToolDefinitions : excludeSubAgentSpawnTool(mcpToolDefinitions);
}

function excludeSubAgentSpawnTool(toolDefinitions: LlmToolDefinition[]): LlmToolDefinition[] {
  return toolDefinitions.filter((tool) => tool.name !== spawnSubAgentToolName);
}

function backgroundSafeToolDefinitions(toolDefinitions: LlmToolDefinition[]): LlmToolDefinition[] {
  return toolDefinitions.filter(
    (tool) =>
      tool.name !== askUserChoiceToolName &&
      tool.name !== requestDirectoryAccessToolName &&
      tool.name !== editMcpConfigToolName &&
      tool.name !== requestScheduledTaskGlobalAccessToolName,
  );
}

function mcpToolTitle(binding: McpToolBinding, args: Record<string, unknown>): string {
  if (isAskUserChoiceToolBinding(binding)) {
    return userChoiceToolTitle(args);
  }

  if (isRequestDirectoryAccessToolBinding(binding)) {
    return directoryAccessToolTitle(args);
  }

  if (isEditMcpConfigToolBinding(binding)) {
    return "Approve MCP config replacement";
  }

  if (isScheduledTaskGlobalAccessToolBinding(binding)) {
    return scheduledTaskGlobalAccessToolTitle();
  }

  if (isCommandRunnerToolBinding(binding)) {
    return commandRunnerToolTitle(binding.toolName, args);
  }

  if (binding.serverName === "Truss Web Tools") {
    return trussWebToolTitle(binding.toolName, args);
  }

  return `${binding.serverName}: ${binding.toolName}`;
}

function unknownToolTitle(toolName: string): string {
  const normalized = toolName.trim();

  return normalized ? `Unknown tool: ${truncateErrorLine(normalized)}` : "Unknown MCP tool";
}

function mcpToolMeta({
  binding,
  fallbackModel,
  filesystemWorkspacePath,
  mcpSettings,
  sessionId,
  toolSettings,
}: {
  binding: McpToolBinding;
  fallbackModel: ToolExecutionModelReference;
  filesystemWorkspacePath?: string | null;
  mcpSettings: McpSettingsSummary;
  sessionId: string;
  toolSettings: ChatToolSettings;
}): Record<string, unknown> | undefined {
  if (binding.serverName === "Truss Orchestration Tools") {
    return { sessionId };
  }

  if (binding.serverName === "Truss Filesystem Tools" && filesystemWorkspacePath) {
    return { filesystemWorkspacePath, sessionId };
  }

  if (binding.serverName === trussChatToolsServerName) {
    // Lets create_scheduled_task default to the calling agent's own model
    // selection, per the "same LLM selection as the model is" requirement.
    return { fallbackModel, sessionId };
  }

  if (binding.serverName !== "Truss Web Tools") {
    return undefined;
  }

  return {
    fallbackModel,
    settings: {
      sanitizerModelId:
        toolSettings.sanitizerModelId ?? mcpSettings.sanitizerModelId ?? null,
      sanitizerProviderId:
        toolSettings.sanitizerProviderId ?? mcpSettings.sanitizerProviderId ?? null,
    },
  };
}

async function executeUserChoiceTool({
  args,
  context,
  onUserChoiceRequest,
  signal,
}: {
  args: Record<string, unknown>;
  context: ServerContext;
  onUserChoiceRequest(request: ChatUserChoiceRequest): void;
  signal?: AbortSignal;
}): Promise<string> {
  const request = createUserChoiceRequest(args, createId("choice"));
  const result = context.chatUserChoices.waitForChoice(request, userChoiceTimeoutMs, signal);

  onUserChoiceRequest(request);

  return formatUserChoiceToolResult(await result);
}

async function executeDirectoryAccessRequestTool({
  args,
  context,
  modelId,
  onUserChoiceRequest,
  signal,
  session,
}: {
  args: Record<string, unknown>;
  context: ServerContext;
  modelId: string;
  onUserChoiceRequest(request: ChatUserChoiceRequest): void;
  signal?: AbortSignal;
  session: AgentSessionSummary;
}): Promise<string> {
  const request = createDirectoryAccessRequest(args, createId("choice"));
  const existingAccess = await existingDirectoryAccessGrant(context, request);

  if (existingAccess) {
    publishAutomaticDirectoryAccessApprovalNote({
      context,
      directoryPath: existingAccess.directoryPath,
      modelId,
      requestedReadOnly: request.directoryAccess?.readOnly === true,
      rootPath: existingAccess.rootPath,
      rootReadOnly: existingAccess.rootReadOnly,
      session,
    });

    return formatAutomaticDirectoryAccessApprovalResult({
      directoryPath: existingAccess.directoryPath,
      request,
      rootReadOnly: existingAccess.rootReadOnly,
      rootPath: existingAccess.rootPath,
    });
  }

  const result = context.chatUserChoices.waitForChoice(request, userChoiceTimeoutMs, signal);

  onUserChoiceRequest(request);

  return formatUserChoiceToolResult(await result);
}

async function existingDirectoryAccessGrant(
  context: ServerContext,
  request: ChatUserChoiceRequest,
): Promise<{ directoryPath: string; rootPath: string; rootReadOnly: boolean } | null> {
  const requestedDirectory = request.directoryAccess?.directoryPath;
  const requestedReadOnly = request.directoryAccess?.readOnly === true;

  if (!requestedDirectory) {
    return null;
  }

  let directoryPath: string;

  try {
    directoryPath = await normalizeFileAccessDirectory(requestedDirectory);
  } catch {
    return null;
  }

  const root = mostSpecificContainingFileAccessRoot(
    await activeFileAccessGrantRoots(context),
    directoryPath,
  );

  if (!root || (!requestedReadOnly && root.readOnly)) {
    return null;
  }

  return { directoryPath, rootPath: root.path, rootReadOnly: root.readOnly };
}

function publishAutomaticDirectoryAccessApprovalNote({
  context,
  directoryPath,
  modelId,
  requestedReadOnly,
  rootPath,
  rootReadOnly,
  session,
}: {
  context: ServerContext;
  directoryPath: string;
  modelId: string;
  requestedReadOnly: boolean;
  rootPath: string;
  rootReadOnly: boolean;
  session: AgentSessionSummary;
}): void {
  const requestedAccess = requestedReadOnly ? "read-only access" : "read/write access";
  const rootAccess = rootReadOnly ? "read-only root" : "read/write root";
  const message = context.chatMessages.createChatMessage({
    id: createId("msg"),
    sessionId: session.id,
    role: "assistant",
    content: [
      "[Truss system event]: Automatically approved directory access",
      `for ${directoryPath} because the requested ${requestedAccess} is already covered by the active ${rootAccess} ${rootPath}.`,
      "No Security settings changed and MCP was not reloaded.",
    ].join(" "),
  });

  publishAgentMessage({
    context,
    message,
    modelId,
    sessionId: session.id,
  });
}

function formatAutomaticDirectoryAccessApprovalResult({
  directoryPath,
  request,
  rootReadOnly,
  rootPath,
}: {
  directoryPath: string;
  request: ChatUserChoiceRequest;
  rootReadOnly: boolean;
  rootPath: string;
}): string {
  const allowOption = request.options[0];
  const requestedReadOnly = request.directoryAccess?.readOnly === true;

  return `${JSON.stringify(
    {
      approved: true,
      approvedAutomatically: true,
      access: requestedReadOnly ? "read-only" : "read-write",
      directoryPath,
      existingAccessRoot: rootPath,
      existingAccessRootReadOnly: rootReadOnly,
      mcpReloaded: false,
      message:
        "Truss already had access to the requested directory, so it was approved automatically without changing Security settings or reloading MCP servers.",
      question: request.question,
      readOnly: requestedReadOnly,
      resolvedAt: new Date().toISOString(),
      selectedOption: allowOption
        ? {
            description:
              "Truss already has this directory through active file-access roots; no Security changes or MCP reload were needed.",
            id: allowOption.id,
            index: 0,
            label: allowOption.label,
            value: allowOption.value ?? allowOption.label,
          }
        : undefined,
      selectionType: "option",
    },
    null,
    2,
  )}\n`;
}

async function executeMcpConfigEditApprovalTool({
  args,
  context,
  onUserChoiceRequest,
  signal,
}: {
  args: Record<string, unknown>;
  context: ServerContext;
  onUserChoiceRequest(request: ChatUserChoiceRequest): void;
  signal?: AbortSignal;
}): Promise<string> {
  if (args.confirmOverwrite !== true) {
    throw new Error("edit_mcp_config requires confirmOverwrite: true.");
  }

  const mcpConfigText = requiredStringToolArg(args, "mcpConfigText", maxMcpConfigToolLength);
  const validation = validateMcpConfigText(
    mcpConfigText,
    context.options.trussHome.mcpConfigPath,
    "truss-global",
  );

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const request = createMcpConfigApprovalRequest({
    id: createId("choice"),
    mcpConfigPath: context.options.trussHome.mcpConfigPath,
    serverCount: validation.config.servers.length,
    stdioServerCount: validation.config.servers.filter(
      (server) => server.transport === "stdio" && !server.disabled && !server.trussManaged,
    ).length,
  });
  const result = context.chatUserChoices.waitForChoice(request, userChoiceTimeoutMs, signal);

  onUserChoiceRequest(request);

  const choice = await result;

  if (choice.cancelled || choice.selectedOption?.value !== "approve") {
    return formatUserChoiceToolResult(choice);
  }

  const write = await writeGlobalMcpConfigText({
    approveStdioServers: true,
    mcpConfigText,
    options: {
      conversationWorkspacePath: context.options.conversationWorkspacePath,
      filesystemGrants: context.filesystemGrants,
      projectRoot: context.options.projectRoot,
      trussHome: context.options.trussHome,
      workspacePath: context.options.workspacePath,
    },
  });

  return `${JSON.stringify(
    {
      approvedByUser: true,
      approvedStdioServers: write.approvedStdioServers,
      mcpConfigPath: context.options.trussHome.mcpConfigPath,
      reloadRequired: true,
      restartRequired: false,
      serverCount: write.servers.length,
      validJson: true,
      warning: "Use Settings > MCP Servers > Reload MCP servers to connect changed MCP servers.",
    },
    null,
    2,
  )}\n`;
}

function isEditMcpConfigToolBinding(binding: {
  serverName: string;
  toolName: string;
}): boolean {
  return (
    binding.serverName === trussChatToolsServerName &&
    binding.toolName === editMcpConfigToolName
  );
}

function createMcpConfigApprovalRequest({
  id,
  mcpConfigPath,
  serverCount,
  stdioServerCount,
}: {
  id: string;
  mcpConfigPath: string;
  serverCount: number;
  stdioServerCount: number;
}): ChatUserChoiceRequest {
  return {
    allowCustomOption: false,
    customOptionLabel: "",
    customOptionPlaceholder: "",
    icon: "warning",
    id,
    kind: "choice",
    options: [
      {
        description:
          "Replace mcp.json and approve any active external stdio commands in this replacement.",
        id: "approve-mcp-config",
        label: "Approve replacement",
        value: "approve",
      },
      {
        description: "Leave the current mcp.json unchanged.",
        id: "deny-mcp-config",
        label: "Deny",
        value: "deny",
      },
    ],
    question: [
      `The assistant wants to replace ${mcpConfigPath}.`,
      `The replacement defines ${serverCount} MCP server${serverCount === 1 ? "" : "s"}.`,
      stdioServerCount > 0
        ? `${stdioServerCount} active external stdio server${stdioServerCount === 1 ? "" : "s"} may run local commands after reload.`
        : "No active external stdio server commands were found in the replacement.",
    ].join("\n\n"),
    title: "Approve MCP config",
  };
}

async function executeScheduledTaskGlobalAccessRequestTool({
  args,
  context,
  onUserChoiceRequest,
  signal,
}: {
  args: Record<string, unknown>;
  context: ServerContext;
  onUserChoiceRequest(request: ChatUserChoiceRequest): void;
  signal?: AbortSignal;
}): Promise<string> {
  const workspacePath = context.options.conversationWorkspacePath;

  if (!workspacePath) {
    // The global instance already sees every scheduled task; no grant is needed.
    return `${JSON.stringify(
      {
        alreadyGranted: true,
        granted: true,
        message: "This Truss instance is not workspace-scoped, so it already has full visibility into global scheduled tasks.",
        workspacePath: null,
      },
      null,
      2,
    )}\n`;
  }

  if (context.scheduledTaskGrants.hasGlobalAccess(workspacePath)) {
    return `${JSON.stringify(
      {
        alreadyGranted: true,
        granted: true,
        message: "This workspace already has permanent access to global scheduled tasks and their run outputs.",
        workspacePath,
      },
      null,
      2,
    )}\n`;
  }

  const request = createScheduledTaskGlobalAccessRequest(args, createId("choice"), workspacePath);
  const result = context.chatUserChoices.waitForChoice(request, userChoiceTimeoutMs, signal);

  onUserChoiceRequest(request);

  const choice = await result;

  if (choice.cancelled || choice.selectedOption?.value !== "allow") {
    return formatUserChoiceToolResult(choice);
  }

  context.scheduledTaskGrants.grantGlobalAccess(workspacePath);

  return `${JSON.stringify(
    {
      granted: true,
      grantedAt: new Date().toISOString(),
      message: "Permanent access to global scheduled tasks and their run outputs was granted for this workspace.",
      workspacePath,
    },
    null,
    2,
  )}\n`;
}

function requiredStringToolArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = args[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return value;
}

function replaceToolCall(toolCalls: ChatToolCall[], nextCall: ChatToolCall): void {
  const index = toolCalls.findIndex((call) => call.id === nextCall.id);

  if (index >= 0) {
    const existing = toolCalls[index];

    toolCalls[index] = existing ? mergeChatToolCall(existing, nextCall) : nextCall;
  }
}

function mergeToolCallThinking(
  thinking: ChatThinking | null,
  toolCalls: ChatToolCall[],
  startedAt: number,
  toolRuntimeMs = 0,
): ChatThinking | null {
  const durationMs = thinking ? thinking.durationMs + toolRuntimeMs : toolRuntimeMs;

  if (toolCalls.length === 0) {
    return thinking && toolRuntimeMs > 0
      ? {
          ...thinking,
          durationMs,
        }
      : thinking;
  }

  if (thinking) {
    return {
      ...thinking,
      durationMs,
      toolCalls,
    };
  }

  return {
    content: "",
    durationMs: durationMs > 0 ? durationMs : Date.now() - startedAt,
    toolCalls,
    wordCount: 0,
  };
}

function normalizeThinking(thinking: ChatThinking | null): ChatThinking | null {
  if (!thinking) {
    return null;
  }

  const content = thinking.content.trim();

  if (!content) {
    return null;
  }

  return {
    ...thinking,
    content,
  };
}

function renderFailedToolCallsMessage(
  toolCalls: ChatToolCall[],
  maxConsecutiveToolFailures: number,
): string {
  const failed = trailingFailedToolCalls(toolCalls);

  return [
    `I stopped tool use because ${maxConsecutiveToolFailures} consecutive tool calls failed.`,
    "",
    ...failed.map(
      (toolCall) =>
        `- ${toolCall.title}: ${truncateErrorLine(toolCall.error ?? "Unknown tool error.")}`,
    ),
    "",
    "Open the thinking details to inspect the tool arguments and full error output.",
  ].join("\n");
}

export function shouldStopAfterContinuousToolFailures(
  toolCalls: ChatToolCall[],
  maxConsecutiveToolFailures: number,
): boolean {
  return countTrailingToolFailures(toolCalls) >= maxConsecutiveToolFailures;
}

function trailingFailedToolCalls(toolCalls: ChatToolCall[]): ChatToolCall[] {
  const trailingFailures: ChatToolCall[] = [];

  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];

    if (!toolCall || toolCall.status !== "error") {
      break;
    }

    trailingFailures.push(toolCall);
  }

  return trailingFailures.reverse();
}

function countTrailingToolFailures(toolCalls: ChatToolCall[]): number {
  let count = 0;

  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    if (toolCalls[index]?.status !== "error") {
      break;
    }

    count += 1;
  }

  return count;
}

function renderToolErrorObservation(toolCall: ChatToolCall, error: string): string {
  return [
    "tool_error:",
    `  title: ${truncateErrorLine(toolCall.title)}`,
    `  tool_id: ${truncateErrorLine(toolCall.toolId)}`,
    `  message: ${truncateErrorLine(error)}`,
    "  details: Open the thinking details for the complete tool error.",
  ].join("\n");
}

function renderToolCompletionFailureMessage(error: string): string {
  return [
    "I couldn't complete the requested tool use because the model's tool-use response kept failing.",
    "",
    `Error: ${truncateErrorLine(error)}`,
  ].join("\n");
}

function renderToolCompletionFailureObservation(
  error: string,
  failureCount: number,
  maxFailures: number,
): string {
  return [
    "[Truss tool-use response error]",
    `The previous model response could not be used as a chat message or tool call: ${truncateErrorLine(error)}`,
    `Attempt ${failureCount} of ${maxFailures - 1} recovery attempts.`,
    "Try again with normal assistant text or valid tool calls. If the previous tool call failed, use the observation already in the conversation and adjust the next tool call.",
  ].join("\n");
}

function renderToolReasoningBudgetFailureMessage(error: string): string {
  return [
    "I stopped tool use because the reasoning budget was exhausted.",
    "",
    "Truss then asked the model for a direct answer, but that request failed.",
    "",
    `Error: ${truncateErrorLine(error)}`,
  ].join("\n");
}

function renderToolTurnLimitMessage(maxToolTurns: number): string {
  return `Agentic turn limit reached (${maxToolTurns}). Resume or increase the limit in Settings \u2192 AI Behaviour.`;
}

function truncateErrorLine(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  const maxLength = 280;

  return singleLine.length <= maxLength
    ? singleLine
    : `${singleLine.slice(0, maxLength - 3)}...`;
}

function normalizeToolErrorMessage(caught: unknown): string {
  const message = messageFromUnknown(caught).trim() || "Unknown tool error.";

  return truncateToolObservation(message, maxToolErrorLength, "tool error");
}

function truncateToolObservation(value: string, maxLength: number, label: string): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}\n\n[truncated: ${label} exceeded ${maxLength} characters]`;
}

function validateToolSettings(
  value: ChatToolSettings | null | undefined,
): { ok: true; settings: ChatToolSettings } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, settings: normalizeChatToolSettings(value) };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "tools must be an object." };
  }

  for (const key of ["webSearchEnabled", "loadWebpageEnabled"] as const) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean") {
      return { ok: false, error: `${key} must be a boolean.` };
    }
  }

  for (const key of [
    "sanitizerProviderId",
    "sanitizerModelId",
  ] as const) {
    if (
      Object.hasOwn(value, key) &&
      value[key] !== null &&
      value[key] !== undefined &&
      typeof value[key] !== "string"
    ) {
      return { ok: false, error: `${key} must be a string or null.` };
    }
  }

  if (
    Object.hasOwn(value, "disabledMcpServerIds") &&
    !isStringArray(value.disabledMcpServerIds)
  ) {
    return { ok: false, error: "disabledMcpServerIds must be an array of strings." };
  }

  if (
    Object.hasOwn(value, "disabledMcpTools") &&
    !isStringArrayRecord(value.disabledMcpTools)
  ) {
    return { ok: false, error: "disabledMcpTools must map server ids to string arrays." };
  }

  return { ok: true, settings: normalizeChatToolSettings(value) };
}

function normalizeChatToolSettings(value: ChatToolSettings | null | undefined): ChatToolSettings {
  return {
    disabledMcpServerIds: normalizeStringArray(value?.disabledMcpServerIds),
    disabledMcpTools: normalizeStringArrayRecord(value?.disabledMcpTools),
    loadWebpageEnabled:
      typeof value?.loadWebpageEnabled === "boolean"
        ? value.loadWebpageEnabled
        : defaultChatToolSettings.loadWebpageEnabled,
    sanitizerModelId: value?.sanitizerModelId?.trim() || null,
    sanitizerProviderId: value?.sanitizerProviderId?.trim() || null,
    webSearchEnabled:
      typeof value?.webSearchEnabled === "boolean"
        ? value.webSearchEnabled
        : defaultChatToolSettings.webSearchEnabled,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(isStringArray)
  );
}

function normalizeStringArray(value: unknown): string[] {
  return isStringArray(value)
    ? [...new Set(value.map((item) => item.trim()).filter(Boolean))]
    : [];
}

function normalizeStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isStringArrayRecord(value)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};

  for (const [key, items] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedItems = normalizeStringArray(items);

    if (normalizedKey && normalizedItems.length > 0) {
      normalized[normalizedKey] = normalizedItems;
    }
  }

  return normalized;
}
