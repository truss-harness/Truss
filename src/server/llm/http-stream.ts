const chatCompletionTimeoutMs = 240_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: { controller?: AbortController; signal?: AbortSignal } = {},
): Promise<Response> {
  const controller = options.controller ?? new AbortController();
  let timedOut = false;
  const abortForSignal = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, chatCompletionTimeoutMs);

  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortForSignal, { once: true });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      if (options.signal?.aborted && !timedOut) {
        throw caught;
      }

      throw new Error("Timed out while waiting for the model.");
    }

    throw caught;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortForSignal);
  }
}

export async function* readResponseLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }
  }

  buffer += decoder.decode();

  if (buffer) {
    yield buffer;
  }
}

export async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function providerErrorMessage(body: unknown, response: Response): string {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === "object") {
    const error = (body as Record<string, unknown>).error;

    if (typeof error === "string") {
      return error;
    }

    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;

      if (typeof message === "string") {
        return message;
      }
    }
  }

  return `Model request failed: ${response.status} ${response.statusText}`;
}
