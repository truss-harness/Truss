export type McpTransport = "stdio" | "http-sse" | "streamable-http" | "unknown";

export type McpAuthDefinition =
  | {
      envVar: string;
      headerName?: string;
      prefix?: string;
      type: "api-key";
    }
  | {
      clientIdEnv: string;
      clientSecretEnv: string;
      scope?: string;
      tokenUrl: string;
      type: "oauth2-client-credentials";
    }
  | {
      accessTokenEnv?: string;
      clientIdEnv?: string;
      clientSecretEnv?: string;
      refreshTokenEnv?: string;
      scope?: string;
      tokenUrl?: string;
      type: "oauth2-authorization-code";
    };

export interface McpServerDefinition {
  auth?: McpAuthDefinition;
  args?: string[];
  command?: string;
  cwd?: string;
  disabled?: boolean;
  disabledReason?: string;
  env?: Record<string, string>;
  envHeaders?: Record<string, string>;
  headers?: Record<string, string>;
  id: string;
  name: string;
  source: string;
  stdioCommandApprovalKey?: string;
  stdioCommandApproved?: boolean;
  trussManaged: boolean;
  transport: McpTransport;
  configPath: string;
  url?: string;
}

export interface McpSourceResult {
  configFiles: string[];
  serverCount: number;
  source: string;
}

export interface McpLoaderResult {
  configFiles: string[];
  servers: McpServerDefinition[];
  source: string;
  sources?: McpSourceResult[];
}

export interface McpConfigLoader {
  source: string;
  candidatePaths(workspacePath: string): string[];
  load(workspacePath: string): Promise<McpLoaderResult>;
}
