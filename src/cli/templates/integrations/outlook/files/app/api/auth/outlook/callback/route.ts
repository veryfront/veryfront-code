import { exchangeCodeForTokens } from "../../../../../lib/oauth";
import { setTokens } from "../../../../../lib/token-store";
import { Buffer } from "node:buffer";

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
    const redirectUri = `${baseUrl}/api/auth/outlook/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Decode JWT to get user info (basic decode, no verification needed for display)
    let userEmail: string | undefined;
    let userId: string | undefined;

    if (tokens.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokens.id_token.split(".")[1], "base64").toString(),
        );
        userEmail = payload.email || payload.preferred_username;
        userId = payload.oid || payload.sub;
      } catch (e) {
        // If JWT parsing fails, continue without user info
        console.warn("Failed to parse ID token:", e);
      }
    }

    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      userId,
      userEmail,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("Microsoft OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
