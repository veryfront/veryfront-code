// Airtable OAuth utilities with PKCE support

import { Buffer } from "node:buffer";
const AIRTABLE_AUTH_URL = "https://airtable.com/oauth2/v1/authorize";
const AIRTABLE_TOKEN_URL = "https://airtable.com/oauth2/v1/token";

// PKCE utilities
function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array.buffer);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(hash);
}

export interface PKCEState {
  verifier: string;
  state: string;
}

// In-memory store for PKCE state (in production, use a database or session store)
const pkceStore = new Map<string, string>();

export function storePKCEVerifier(state: string, verifier: string): void {
  pkceStore.set(state, verifier);
}

export function retrievePKCEVerifier(state: string): string | undefined {
  const verifier = pkceStore.get(state);
  if (verifier) {
    pkceStore.delete(state); // One-time use
  }
  return verifier;
}

export async function getAuthorizationUrl(
  redirectUri: string,
  state?: string,
): Promise<{ url: string; pkceState: PKCEState }> {
  const clientId = process.env.AIRTABLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("AIRTABLE_CLIENT_ID environment variable is not set");
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const authState = state || crypto.randomUUID();

  // Store the verifier for later retrieval
  storePKCEVerifier(authState, verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: authState,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "data.records:read data.records:write schema.bases:read schema.bases:write",
  });

  return {
    url: `${AIRTABLE_AUTH_URL}?${params.toString()}`,
    pkceState: { verifier, state: authState },
  };
}

export interface AirtableTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<AirtableTokenResponse> {
  const clientId = process.env.AIRTABLE_CLIENT_ID;
  const clientSecret = process.env.AIRTABLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("AIRTABLE_CLIENT_ID and AIRTABLE_CLIENT_SECRET must be set");
  }

  // Airtable uses Basic auth for token exchange
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(AIRTABLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error || response.statusText}`);
  }

  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<AirtableTokenResponse> {
  const clientId = process.env.AIRTABLE_CLIENT_ID;
  const clientSecret = process.env.AIRTABLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("AIRTABLE_CLIENT_ID and AIRTABLE_CLIENT_SECRET must be set");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(AIRTABLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
