import type { JsonRpcMessage } from "../json-rpc.ts";
import type { McpServerDefinition } from "../types.ts";

export interface McpTransport {
  definition: McpServerDefinition;
  close(): Promise<void>;
  messages(): AsyncIterable<JsonRpcMessage>;
  send(message: JsonRpcMessage): Promise<void>;
}

export interface McpTransportFactory {
  supports(definition: McpServerDefinition): boolean;
  create(definition: McpServerDefinition, options: McpTransportOptions): Promise<McpTransport>;
}

export interface McpTransportOptions {
  env: NodeJS.ProcessEnv;
  managedBrowserEnv?: NodeJS.ProcessEnv;
}
