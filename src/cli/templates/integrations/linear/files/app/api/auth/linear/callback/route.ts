import { exchangeCodeForTokens } from "../../../../../lib/oauth";
import { setTokens } from "../../../../../lib/token-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  try {
    const baseUrl = `${url.protocol}//${url.host}`;
    const redirectUri = `${baseUrl}/api/auth/linear/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Calculate token expiration time (expires_in is in seconds)
    const expiresAt = Date.now() + (tokens.expires_in * 1000);

    setTokens({
      accessToken: tokens.access_token,
      expiresAt,
      scope: tokens.scope,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("Linear OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
