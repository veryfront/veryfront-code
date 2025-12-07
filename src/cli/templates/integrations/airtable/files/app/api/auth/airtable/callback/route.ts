import { exchangeCodeForTokens, retrievePKCEVerifier } from "../../../../../lib/oauth";
import { setTokens } from "../../../../../lib/token-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing authorization code or state", { status: 400 });
  }

  try {
    const baseUrl = `${url.protocol}//${url.host}`;
    const redirectUri = `${baseUrl}/api/auth/airtable/callback`;

    // Retrieve the PKCE code verifier
    const codeVerifier = retrievePKCEVerifier(state);
    if (!codeVerifier) {
      return new Response("Invalid state parameter or PKCE session expired", { status: 400 });
    }

    const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);

    // Calculate expiration time
    const expiresAt = Date.now() + (tokens.expires_in * 1000);

    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scope: tokens.scope,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("Airtable OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
