import type {
  ApiError,
  ChatUserChoiceResolutionRequest,
  ChatUserChoiceResolutionResponse,
} from "../../shared/protocol.ts";
import type { ServerContext } from "./context.ts";
import { json, readJson } from "./responses.ts";

export async function handleChatUserChoiceResolutionRoute(
  request: Request,
  context: ServerContext,
  requestId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<ChatUserChoiceResolutionRequest>(request);
  const result = context.chatUserChoices.resolve(requestId, body);

  if (!result.ok) {
    return json<ApiError>({ error: result.error }, { status: result.status });
  }

  return json<ChatUserChoiceResolutionResponse>({ resolved: true });
}
