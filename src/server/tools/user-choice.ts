import type {
  ChatUserChoiceOption,
  ChatUserChoiceRequest,
  ChatUserChoiceToolResult,
} from "../../shared/protocol.ts";

export const askUserChoiceToolName = "ask_user_choice";
export const trussChatToolsServerName = "Truss Chat Tools";
export const maxUserChoiceOptions = 8;
export const maxUserChoiceTitleLength = 100;
export const maxUserChoiceQuestionLength = 1_200;
export const maxUserChoiceOptionLabelLength = 180;
export const maxUserChoiceOptionDescriptionLength = 500;
export const maxUserChoiceCustomResponseLength = 2_000;

const defaultTitle = "Choose an option";
const defaultIcon = "help";
const defaultCustomOptionLabel = "Something else";
const defaultCustomOptionPlaceholder = "Type a different answer";

export function askUserChoiceInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      allowCustomOption: {
        type: "boolean",
        description:
          "Whether the dialog includes a free-text n+1 option. Defaults to true. Custom responses cap at 2000 characters.",
      },
      customOptionLabel: {
        type: "string",
        description: `Label for the free-text option. Defaults to "${defaultCustomOptionLabel}" and caps at 180 characters.`,
        maxLength: maxUserChoiceOptionLabelLength,
      },
      customOptionPlaceholder: {
        type: "string",
        description: `Placeholder for the free-text answer. Defaults to "${defaultCustomOptionPlaceholder}" and caps at 180 characters.`,
        maxLength: maxUserChoiceOptionLabelLength,
      },
      icon: {
        type: "string",
        description:
          "Optional Material Symbols icon name shown in the dialog header, such as help, rule, warning, or tune. Letters, numbers, and underscores are accepted; invalid names fall back to help.",
        maxLength: 64,
        pattern: "^[a-zA-Z0-9_]{1,64}$",
      },
      options: {
        type: "array",
        description: "Multiple-choice answers shown to the user. Provide one to eight choices.",
        minItems: 1,
        maxItems: maxUserChoiceOptions,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: {
              type: "string",
              description: "Optional short explanation of the tradeoff or impact. Caps at 500 characters.",
              maxLength: maxUserChoiceOptionDescriptionLength,
            },
            label: {
              type: "string",
              description: "Short answer label displayed as the choice. Caps at 180 characters.",
              maxLength: maxUserChoiceOptionLabelLength,
            },
            value: {
              type: "string",
              description:
                "Optional machine-readable value returned when this choice is selected. Defaults to the label and caps at 180 characters.",
              maxLength: maxUserChoiceOptionLabelLength,
            },
          },
          required: ["label"],
        },
      },
      question: {
        type: "string",
        description: "The question to ask the user. Caps at 1200 characters.",
        maxLength: maxUserChoiceQuestionLength,
      },
      title: {
        type: "string",
        description: `Short dialog title. Defaults to "${defaultTitle}" and caps at 100 characters.`,
        maxLength: maxUserChoiceTitleLength,
      },
    },
    required: ["question", "options"],
  };
}

export function createUserChoiceRequest(
  args: Record<string, unknown>,
  id: string,
): ChatUserChoiceRequest {
  return {
    allowCustomOption: optionalBoolean(args, "allowCustomOption", true),
    customOptionLabel:
      optionalTrimmedString(
        args,
        "customOptionLabel",
        maxUserChoiceOptionLabelLength,
      ) ?? defaultCustomOptionLabel,
    customOptionPlaceholder:
      optionalTrimmedString(
        args,
        "customOptionPlaceholder",
        maxUserChoiceOptionLabelLength,
      ) ?? defaultCustomOptionPlaceholder,
    icon: normalizeMaterialIconName(
      optionalTrimmedString(args, "icon", 64) ?? defaultIcon,
    ),
    id,
    kind: "choice",
    options: normalizeUserChoiceOptions(args.options),
    question: requiredTrimmedString(args, "question", maxUserChoiceQuestionLength),
    title: optionalTrimmedString(args, "title", maxUserChoiceTitleLength) ?? defaultTitle,
  };
}

export function userChoiceToolTitle(args: Record<string, unknown>): string {
  const title = safeTitleText(args.title);
  const question = safeTitleText(args.question);
  const subject = title ?? question ?? "user choice";

  return `Ask user: ${subject}`;
}

export function isAskUserChoiceToolBinding(binding: {
  serverName: string;
  toolName: string;
}): boolean {
  return (
    binding.serverName === trussChatToolsServerName &&
    binding.toolName === askUserChoiceToolName
  );
}

export function formatUserChoiceToolResult(result: ChatUserChoiceToolResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function normalizeUserChoiceOptions(value: unknown): ChatUserChoiceOption[] {
  if (!Array.isArray(value)) {
    throw new Error("options must be an array.");
  }

  if (value.length < 1) {
    throw new Error("options must include at least one choice.");
  }

  if (value.length > maxUserChoiceOptions) {
    throw new Error(`options may include at most ${maxUserChoiceOptions} choices.`);
  }

  return value.map((option, index) => normalizeUserChoiceOption(option, index));
}

function normalizeUserChoiceOption(value: unknown, index: number): ChatUserChoiceOption {
  if (typeof value === "string") {
    const label = normalizeTrimmedText(
      value,
      `options[${index}].label`,
      maxUserChoiceOptionLabelLength,
    );

    if (!label) {
      throw new Error(`options[${index}].label is required.`);
    }

    return {
      id: `option-${index + 1}`,
      label,
      value: label,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`options[${index}] must be an object.`);
  }

  const option = value as Record<string, unknown>;
  const label = requiredTrimmedString(option, "label", maxUserChoiceOptionLabelLength);
  const description = optionalTrimmedString(
    option,
    "description",
    maxUserChoiceOptionDescriptionLength,
  );
  const optionValue =
    optionalTrimmedString(option, "value", maxUserChoiceOptionLabelLength) ?? label;

  return {
    ...(description ? { description } : {}),
    id: `option-${index + 1}`,
    label,
    value: optionValue,
  };
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

  return normalizeTrimmedText(value, key, maxLength) || null;
}

function normalizeTrimmedText(value: string, key: string, maxLength: number): string {
  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return trimmed;
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

function normalizeMaterialIconName(value: string): string {
  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9_]{1,64}$/.test(normalized) ? normalized : defaultIcon;
}

function safeTitleText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.length <= maxUserChoiceTitleLength
    ? trimmed
    : `${trimmed.slice(0, maxUserChoiceTitleLength - 3)}...`;
}
