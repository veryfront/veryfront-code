/**
 * Google Sheets OAuth Callback
 *
 * Handles the OAuth callback from Google and exchanges code for tokens
 */

import { exchangeCodeForTokens } from "../../../../../lib/oauth.ts";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { sheetsOAuthProvider } from "../../../../../lib/sheets-client.ts";

// Default user ID for demo/dev purposes
// In production, replace with actual user session management
const DEFAULT_USER_ID = "demo-user";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  // Check for OAuth errors
  if (error) {
    return new Response(
      `OAuth error: ${error}`,
      { status: 400 },
    );
  }

  if (!code) {
    return new Response(
      "Missing authorization code",
      { status: 400 },
    );
  }

  // Validate state (CSRF protection)
  // In a real app, validate against the stored state cookie
  const cookies = req.headers.get("cookie") || "";
  const stateCookie = cookies
    .split(";")
    .find((c) => c.trim().startsWith("sheets_oauth_state="))
    ?.split("=")[1];

  if (!stateCookie || stateCookie !== state) {
    return new Response(
      "Invalid state parameter (CSRF protection)",
      { status: 400 },
    );
  }

  try {
    const origin = url.origin;
    const redirectUri = `${origin}${sheetsOAuthProvider.callbackPath}`;

    // Exchange code for tokens
    const token = await exchangeCodeForTokens(
      sheetsOAuthProvider,
      code,
      redirectUri,
    );

    // Store tokens for the user
    await tokenStore.setToken(DEFAULT_USER_ID, "sheets", token);

    // Redirect back to the app with success
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/?sheets_connected=true",
        "Set-Cookie": "sheets_oauth_state=; Path=/; HttpOnly; Max-Age=0", // Clear state cookie
      },
    });
  } catch (err) {
    console.error("Sheets OAuth error:", err);
    return new Response(
      `Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      { status: 500 },
    );
  }
}
