import type { ApiError, ToolResolutionRequest } from "../../shared/protocol.ts";
import type { SampleAgent } from "../agent/sample-agent.ts";
import { json, readJson } from "./responses.ts";

export async function handleToolResolutionRoute(
  request: Request,
  executionId: string,
  agent: SampleAgent,
): Promise<Response> {
  const body = await readJson<ToolResolutionRequest>(request);
  const resolved = agent.resolveTool(executionId, body?.payload ?? null);

  if (!resolved) {
    return json<ApiError>({ error: "Unknown or already resolved tool execution" }, { status: 404 });
  }

  return json({ accepted: true });
}
