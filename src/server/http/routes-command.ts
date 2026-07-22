import type { ApiError, CommandAccepted, CommandRequest } from "../../shared/protocol.ts";
import type { SampleAgent } from "../agent/sample-agent.ts";
import { json, readJson } from "./responses.ts";

export async function handleCommandRoute(
  request: Request,
  agent: SampleAgent,
): Promise<Response> {
  const body = await readJson<CommandRequest>(request);
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  if (!content) {
    return json<ApiError>({ error: "Command content is required" }, { status: 400 });
  }

  const accepted = agent.acceptCommand(content);

  return json<CommandAccepted>(accepted, { status: 202 });
}
