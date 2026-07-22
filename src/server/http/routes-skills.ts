import type {
  ApiError,
  SkillReadRequest,
  SkillReadResponse,
  SkillSummary,
} from "../../shared/protocol.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";

const maxSkillIdLength = 1_000;

export async function handleSkillReadRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = ((await readJson<Partial<SkillReadRequest>>(request)) ?? {}) as Partial<SkillReadRequest>;
  const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";

  if (!skillId) {
    return json<ApiError>({ error: "skillId is required" }, { status: 400 });
  }

  if (skillId.length > maxSkillIdLength) {
    return json<ApiError>({ error: "skillId is too long" }, { status: 400 });
  }

  const skill = context.skills.skills.find((item) => item.id === skillId);

  if (!skill) {
    return json<ApiError>({ error: "Skill is not discovered in this Truss session" }, { status: 404 });
  }

  const file = Bun.file(skill.path);

  if (!(await file.exists())) {
    return json<ApiError>({ error: "Skill file no longer exists" }, { status: 404 });
  }

  return json<SkillReadResponse>({
    body: await file.text(),
    skill: skillForResponse(skill),
  });
}

function skillForResponse(skill: SkillSummary): SkillSummary {
  return { ...skill };
}
