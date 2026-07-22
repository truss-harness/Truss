import type { ChatUserChoiceRequest } from "../../shared/protocol.ts";
import { trussChatToolsServerName } from "./user-choice.ts";

export const requestScheduledTaskGlobalAccessToolName = "request_scheduled_task_global_access";
export const scheduledTaskGlobalAccessAllowOptionId = "allow-scheduled-task-global-access";
export const scheduledTaskGlobalAccessDenyOptionId = "deny-scheduled-task-global-access";

const maxScheduledTaskAccessReasonLength = 1_200;

export function requestScheduledTaskGlobalAccessInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: {
        type: "string",
        description:
          "Short explanation of why this workspace-scoped assistant needs to view global scheduled tasks and their run outputs. Caps at 1200 characters.",
        maxLength: maxScheduledTaskAccessReasonLength,
      },
    },
  };
}

export function createScheduledTaskGlobalAccessRequest(
  args: Record<string, unknown>,
  id: string,
  workspacePath: string,
): ChatUserChoiceRequest {
  const reason = optionalTrimmedString(args, "reason", maxScheduledTaskAccessReasonLength);

  return {
    allowCustomOption: false,
    customOptionLabel: "",
    customOptionPlaceholder: "",
    icon: "schedule",
    id,
    kind: "choice",
    options: [
      {
        description:
          "Permanently allow this workspace to list and read global scheduled tasks and their run outputs. This does not expire.",
        id: scheduledTaskGlobalAccessAllowOptionId,
        label: "Allow",
        value: "allow",
      },
      {
        description: "Keep this workspace limited to its own scheduled tasks.",
        id: scheduledTaskGlobalAccessDenyOptionId,
        label: "Deny",
        value: "deny",
      },
    ],
    question: [
      `The assistant is requesting permanent access to view global (non-workspace) scheduled tasks and their run outputs from workspace ${workspacePath}.`,
      reason ? `Reason: ${reason}` : null,
      "Approving does not expire automatically; remove it later from Scheduled Tasks settings if needed.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n"),
    title: "Scheduled Tasks",
  };
}

export function scheduledTaskGlobalAccessToolTitle(): string {
  return "Request scheduled task global access";
}

export function isScheduledTaskGlobalAccessToolBinding(binding: {
  serverName: string;
  toolName: string;
}): boolean {
  return (
    binding.serverName === trussChatToolsServerName &&
    binding.toolName === requestScheduledTaskGlobalAccessToolName
  );
}

function optionalTrimmedString(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = args[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return trimmed || null;
}
