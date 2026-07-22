import { httpSseTransportFactory } from "./http-sse.ts";
import { stdioTransportFactory } from "./stdio.ts";
import type { McpTransportFactory } from "./types.ts";

export const mcpTransportFactories: McpTransportFactory[] = [
  stdioTransportFactory,
  httpSseTransportFactory,
];
