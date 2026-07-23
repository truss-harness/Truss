import { createServerContext } from "./context.ts";
import { routeRequest } from "./router.ts";
import { SpawnLifecycle } from "./spawn-lifecycle.ts";
import { defaultServerPort, serverPortCandidates } from "../ports.ts";
import type { ServerOptions } from "./context.ts";
import { BrowserBrokerServer, CamoufoxBrokerHost } from "../browser/broker-server.ts";

export async function startServer(options: ServerOptions): Promise<Bun.Server<undefined>> {
  const browserBroker = shouldStartBrowserBroker(options)
    ? BrowserBrokerServer.start({
        host: new CamoufoxBrokerHost({
          env: process.env,
          trussHomeDir: options.trussHome.dir,
        }),
      })
    : null;
  const effectiveOptions = browserBroker
    ? { ...options, browserBroker: browserBroker.credentials }
    : options;
  const context = await createServerContext(effectiveOptions).catch(async (caught) => {
    await browserBroker?.close();
    throw caught;
  });
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
        closeMcp: async () => {
          try {
            await context.mcp.close();
          } finally {
            await browserBroker?.close();
          }
        },
        idleTimeoutMs: options.serviceMode ? null : undefined,
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
        await context.mcp.close().catch(() => undefined);
        await browserBroker?.close();
        context.scheduledTaskScheduler.stop();
        context.database.db.close();
        throw caught;
      }
    }
  }

  await context.mcp.close().catch(() => undefined);
  await browserBroker?.close();
  context.scheduledTaskScheduler.stop();
  context.database.db.close();
  throw new Error("Could not start Truss server.");
}

export function shouldStartBrowserBroker(options: Pick<
  ServerOptions,
  "browserBroker" | "conversationWorkspacePath" | "serviceMode"
>): boolean {
  return (
    options.serviceMode === true ||
    (options.conversationWorkspacePath === null && options.browserBroker === undefined)
  );
}

function isAddressInUseError(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "code" in caught &&
    (caught as { code?: unknown }).code === "EADDRINUSE"
  );
}
