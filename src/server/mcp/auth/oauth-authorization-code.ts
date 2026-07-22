import type { OAuthAccessToken } from "./oauth-client-credentials.ts";

export interface OAuthAuthorizationCodeConfig {
  accessTokenEnv?: string;
  clientIdEnv?: string;
  clientSecretEnv?: string;
  refreshTokenEnv?: string;
  scope?: string;
  tokenUrl?: string;
}

export async function requestAuthorizationCodeToken(
  config: OAuthAuthorizationCodeConfig,
  env: NodeJS.ProcessEnv,
): Promise<OAuthAccessToken | null> {
  const accessToken = config.accessTokenEnv ? env[config.accessTokenEnv] : undefined;

  if (accessToken) {
    return {
      accessToken,
      tokenType: "Bearer",
    };
  }

  const refreshToken = config.refreshTokenEnv ? env[config.refreshTokenEnv] : undefined;

  if (!refreshToken || !config.tokenUrl) {
    return null;
  }

  const clientId = config.clientIdEnv ? env[config.clientIdEnv] : undefined;
  const clientSecret = config.clientSecretEnv ? env[config.clientSecretEnv] : undefined;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(clientId ? { client_id: clientId } : {}),
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    ...(config.scope ? { scope: config.scope } : {}),
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`OAuth authorization-code token refresh failed: ${response.status}`);
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
