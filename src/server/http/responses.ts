export class InvalidJsonRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJsonRequestError";
  }
}

export async function readJson<T>(request: Request): Promise<T | null> {
  const text = await request.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);

    throw new InvalidJsonRequestError(`Malformed JSON request body: ${detail}`);
  }
}

export function json<T>(body: T, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...init.headers,
      "Cache-Control": "no-cache",
    },
  });
}
