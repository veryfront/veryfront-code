import { exchangeCodeForTokens } from "../../../../../lib/oauth.ts";
import { setTokens } from "../../../../../lib/token-store.ts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return new Response(
      `OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`,
      { status: 400 },
    );
  }

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  try {
    const baseUrl = `${url.protocol}//${url.host}`;
    const redirectUri = `${baseUrl}/api/auth/onedrive/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Calculate expiration time
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;

    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      tokenType: tokens.token_type,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("OneDrive OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
