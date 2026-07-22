export interface ApiKeyAuthOptions {
  envVar: string;
  headerName?: string;
  prefix?: string;
}

export function createApiKeyHeaders(
  options: ApiKeyAuthOptions,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const value = env[options.envVar];

  if (!value) {
    return {};
  }

  const headerName = options.headerName ?? "Authorization";
  const prefix = options.prefix ?? "Bearer";

  return {
    [headerName]: `${prefix} ${value}`,
  };
}
