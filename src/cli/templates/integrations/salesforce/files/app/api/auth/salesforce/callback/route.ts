import { exchangeCodeForTokens, parseIdentity } from "../../../../../lib/oauth";
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
    const redirectUri = `${baseUrl}/api/auth/salesforce/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Parse user and org IDs from the id URL
    const identity = parseIdentity(tokens.id);

    // Salesforce tokens don't have an explicit expiry time
    // Access tokens typically last 2 hours, but we'll set a safe 1 hour expiry
    const expiresAt = Date.now() + 3600 * 1000;

    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      instanceUrl: tokens.instance_url,
      expiresAt,
      userId: identity?.userId,
      orgId: identity?.orgId,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("Salesforce OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
