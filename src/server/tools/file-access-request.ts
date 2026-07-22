import type { ChatUserChoiceRequest } from "../../shared/protocol.ts";
import { trussChatToolsServerName } from "./user-choice.ts";

export const requestDirectoryAccessToolName = "request_directory_access";
export const directoryAccessAllowOptionId = "allow-directory";
export const directoryAccessDenyOptionId = "deny-directory";

const maxDirectoryPathLength = 4_000;
const maxDirectoryAccessReasonLength = 1_200;

export function requestDirectoryAccessInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      directoryPath: {
        type: "string",
        description:
          "Absolute directory path the assistant needs added to the active Truss file-access grants. Caps at 4000 characters.",
        maxLength: maxDirectoryPathLength,
      },
      reason: {
        type: "string",
        description:
          "Short explanation of why access is needed and what the assistant intends to inspect or edit. Caps at 1200 characters.",
        maxLength: maxDirectoryAccessReasonLength,
      },
      readOnly: {
        type: "boolean",
        description:
          "Set true when the assistant only needs to list, read, or search files. Read-only grants block write_text_file, patch_text_file, move_file, copy_file, delete_file, and create_directory. Defaults to false for read/write access.",
      },
    },
    required: ["directoryPath", "reason"],
  };
}

export function createDirectoryAccessRequest(
  args: Record<string, unknown>,
  id: string,
): ChatUserChoiceRequest {
  const directoryPath = requiredTrimmedString(args, "directoryPath", maxDirectoryPathLength);
  const reason = optionalTrimmedString(args, "reason", maxDirectoryAccessReasonLength);
  const readOnly = optionalBoolean(args, "readOnly", false);
  const accessLabel = readOnly ? "read-only" : "read/write";

  return {
    allowCustomOption: false,
    customOptionLabel: "",
    customOptionPlaceholder: "",
    directoryAccess: {
      directoryPath,
      readOnly,
      reason,
    },
    icon: "lock",
    id,
    kind: "directory_access",
    options: [
      {
        description: readOnly
          ? "Add this directory to Security as read-only, then reload MCP servers so Truss Filesystem Tools can inspect it without mutating it."
          : "Add this directory to Security with read/write access, then reload MCP servers so Truss Filesystem Tools can use it.",
        id: directoryAccessAllowOptionId,
        label: readOnly ? "Allow read-only" : "Allow directory",
        value: "allow",
      },
      {
        description: "Leave file-access grants unchanged.",
        id: directoryAccessDenyOptionId,
        label: "Deny",
        value: "deny",
      },
    ],
    question: [
      `The assistant is requesting ${accessLabel} access to ${directoryPath}.`,
      reason ? `Reason: ${reason}` : null,
      `Approving grants this directory ${accessLabel} access only for the current Truss workspace or global context, then reloads MCP servers. Access expires automatically after 24 hours unless you remove it sooner from Security.`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n"),
    title: "Security",
  };
}

export function directoryAccessToolTitle(args: Record<string, unknown>): string {
  const directoryPath =
    typeof args.directoryPath === "string" && args.directoryPath.trim()
      ? args.directoryPath.trim()
      : "directory access";
  const prefix = args.readOnly === true ? "Request read-only directory access" : "Request directory access";

  return `${prefix}: ${truncateTitle(directoryPath)}`;
}

export function isRequestDirectoryAccessToolBinding(binding: {
  serverName: string;
  toolName: string;
}): boolean {
  return (
    binding.serverName === trussChatToolsServerName &&
    binding.toolName === requestDirectoryAccessToolName
  );
}

function requiredTrimmedString(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = optionalTrimmedString(args, key, maxLength);

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
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

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = args[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }

  return value;
}

function truncateTitle(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
}
