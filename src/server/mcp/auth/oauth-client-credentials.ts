export interface OAuthClientCredentialsConfig {
  clientIdEnv: string;
  clientSecretEnv: string;
  scope?: string;
  tokenUrl: string;
}

export interface OAuthAccessToken {
  accessToken: string;
  expiresAt?: number;
  tokenType: string;
}

export async function requestClientCredentialsToken(
  config: OAuthClientCredentialsConfig,
  env: NodeJS.ProcessEnv,
): Promise<OAuthAccessToken | null> {
  const clientId = env[config.clientIdEnv];
  const clientSecret = env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    return null;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      ...(config.scope ? { scope: config.scope } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth client credentials request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  if (!payload.access_token) {
    return null;
  }

  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
    tokenType: payload.token_type ?? "Bearer",
  };
}
