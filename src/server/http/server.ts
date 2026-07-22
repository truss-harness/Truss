import { createServerContext } from "./context.ts";
import { routeRequest } from "./router.ts";
import { SpawnLifecycle } from "./spawn-lifecycle.ts";
import { defaultServerPort, serverPortCandidates } from "../ports.ts";
import type { ServerOptions } from "./context.ts";

export async function startServer(options: ServerOptions): Promise<Bun.Server<undefined>> {
  const context = await createServerContext(options);
  let server: Bun.Server<undefined> | undefined;

  for (const port of serverPortCandidates(options.port)) {
    try {
      const runningServer = Bun.serve({
        hostname: "127.0.0.1",
        port,
        idleTimeout: 255,
        fetch: (request) =>
          routeRequest(request, context, server?.port ?? options.port ?? defaultServerPort),
      });
      server = runningServer;
      const runningPort = runningServer.port;

      if (runningPort === undefined) {
        runningServer.stop(true);
        throw new Error("Truss server did not bind a port.");
      }

      const lifecycle = new SpawnLifecycle({
        closeMcp: () => context.mcp.close(),
        onStopped: () => {
          context.scheduledTaskScheduler.stop();
          context.database.db.close();
        },
        port: runningPort,
        processes: context.spawnedProcesses,
        server: runningServer,
        workspacePath: options.workspacePath,
      });
      context.spawnLifecycle = lifecycle;
      lifecycle.start();

      return runningServer;
    } catch (caught) {
      if (options.port !== undefined || port !== defaultServerPort || !isAddressInUseError(caught)) {
        throw caught;
      }
    }
  }

  throw new Error("Could not start Truss server.");
}

function isAddressInUseError(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "code" in caught &&
    (caught as { code?: unknown }).code === "EADDRINUSE"
  );
}
