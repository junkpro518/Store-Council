import { config } from "../config.js";
import { JsonStore } from "../store/jsonStore.js";

export interface SallaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

const tokenStore = new JsonStore<SallaTokens | null>("salla-tokens", null);

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.salla.clientId,
    response_type: "code",
    redirect_uri: config.salla.redirectUri,
    // offline_access is required to receive a refresh token
    scope: "offline_access",
    state,
  });
  return `${config.salla.authBase}/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<SallaTokens> {
  const res = await fetch(`${config.salla.authBase}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.salla.clientId,
      client_secret: config.salla.clientSecret,
      ...body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Salla token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const tokens: SallaTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  tokenStore.write(tokens);
  return tokens;
}

export function exchangeCode(code: string): Promise<SallaTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.salla.redirectUri,
  });
}

export async function getAccessToken(): Promise<string> {
  const tokens = tokenStore.read();
  if (!tokens) {
    throw new Error(
      "Store not connected. Visit /auth/salla to connect a Salla store first."
    );
  }
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  const refreshed = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  return refreshed.access_token;
}

export function isConnected(): boolean {
  return tokenStore.read() !== null;
}
