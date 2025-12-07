import { exchangeCodeForTokens, getAccessibleResources } from "../../../../../lib/oauth";
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
    const redirectUri = `${baseUrl}/api/auth/jira/callback`;

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Get accessible Atlassian resources (sites)
    const resources = await getAccessibleResources(tokens.access_token);

    if (resources.length === 0) {
      return new Response(
        "No accessible Jira sites found. Please ensure your app has access to at least one Jira site.",
        { status: 400 },
      );
    }

    // Use the first accessible site (you could prompt user to select if multiple)
    const primarySite = resources[0];

    // Calculate token expiration
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      cloudId: primarySite.id,
      siteName: primarySite.name,
      expiresAt,
    });

    // Redirect to home page after successful auth
    return Response.redirect(baseUrl);
  } catch (err) {
    console.error("Jira OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
