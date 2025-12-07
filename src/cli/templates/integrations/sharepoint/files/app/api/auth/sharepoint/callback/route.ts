import { exchangeCodeForTokens } from "../../../../../lib/oauth";
import { setTokens } from "../../../../../lib/token-store";

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
    const redirectUri = `${baseUrl}/api/auth/sharepoint/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Calculate expiration time (current time + expires_in seconds - 5 minute buffer)
    const expiresAt = Date.now() + (tokens.expires_in - 300) * 1000;

    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type,
      expiresAt,
      scope: tokens.scope,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("SharePoint OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
