import process from "node:process";
import type { ApiError, SpawnedProcessesResponse } from "../../shared/protocol.ts";
import type { ServerContext } from "./context.ts";
import { json } from "./responses.ts";

export async function handleSpawnedProcessesRoute(
  request: Request,
  context: ServerContext,
  processId: string | null,
  action: string | null,
): Promise<Response> {
  if (request.method === "GET" && processId === null) {
    const processes = context.spawnedProcesses.list().filter((process) => {
      if (isProcessAlive(process.pid)) {
        return true;
      }

      context.spawnedProcesses.remove(process.id);
      return false;
    });

    return json<SpawnedProcessesResponse>({
      currentProcessId: context.spawnLifecycle?.id ?? "",
      processes,
    });
  }

  if (request.method === "POST" && processId && action === "terminate") {
    return terminateProcess(context, processId);
  }

  return json<ApiError>({ error: "Route not found" }, { status: 404 });
}

async function terminateProcess(context: ServerContext, processId: string): Promise<Response> {
  if (context.spawnLifecycle?.id === processId) {
    setTimeout(() => {
      void context.spawnLifecycle?.stop();
    }, 50);

    return json({ accepted: true });
  }

  const process = context.spawnedProcesses.get(processId);

  if (!process || !isProcessAlive(process.pid)) {
    if (process) {
      context.spawnedProcesses.remove(process.id);
    }

    return json<ApiError>({ error: "Spawned process was not found." }, { status: 404 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(
      `http://127.0.0.1:${process.port}/api/spawned-processes/${encodeURIComponent(process.id)}/terminate`,
      {
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return json<ApiError>(
        { error: `Could not terminate spawned process: ${await response.text()}` },
        { status: 502 },
      );
    }

    return json({ accepted: true });
  } catch (caught) {
    return json<ApiError>(
      {
        error:
          caught instanceof Error
            ? `Could not reach spawned process: ${caught.message}`
            : "Could not reach spawned process.",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (caught) {
    return !(caught instanceof Error && "code" in caught && caught.code === "ESRCH");
  }
}
