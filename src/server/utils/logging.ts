const defaultLogValueLength = 2_000;

export function logToStdout(
  scope: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const detailText = details ? ` ${safeJsonForLog(details)}` : "";
  console.error(`[${scope}] ${message}${detailText}`);
}

export function errorForLog(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.stack || caught.message;
  }

  return String(caught);
}

export function messageFromUnknown(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function truncateForLog(value: string, maxLength = defaultLogValueLength): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function safeJsonForLog(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (nestedValue instanceof Error) {
        return {
          message: nestedValue.message,
          name: nestedValue.name,
          stack: nestedValue.stack,
        };
      }

      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }

      if (typeof nestedValue === "string") {
        return truncateForLog(nestedValue);
      }

      return nestedValue;
    });
  } catch (caught) {
    return truncateForLog(String(value ?? caught));
  }
}
