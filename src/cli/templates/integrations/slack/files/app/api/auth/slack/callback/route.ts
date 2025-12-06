/**
 * Slack OAuth Callback
 *
 * Handles the OAuth callback from Slack, exchanges code for tokens,
 * and stores them securely.
 */

import { tokenStore } from "../../../../../lib/token-store.ts";
import { slackOAuthProvider } from "../../../../../lib/slack-client.ts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Handle OAuth errors
  if (error) {
    const errorDescription = url.searchParams.get("error_description") || error;
    return new Response(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Slack Connection Failed</h1>
          <p style="color: #666;">${errorDescription}</p>
          <a href="/" style="color: #0066cc;">Return to App</a>
        </body>
      </html>
      `,
      {
        status: 400,
        headers: { "Content-Type": "text/html" },
      },
    );
  }

  if (!code || !state) {
    return new Response("Missing code or state parameter", { status: 400 });
  }

  // Validate state from cookie
  const cookies = req.headers.get("cookie") || "";
  const stateCookie = cookies
    .split(";")
    .find((c) => c.trim().startsWith("slack_oauth_state="));
  const savedState = stateCookie?.split("=")[1]?.trim();

  if (state !== savedState) {
    return new Response("Invalid state parameter", { status: 400 });
  }

  try {
    const origin = url.origin;
    const redirectUri = `${origin}${slackOAuthProvider.callbackPath}`;

    // Exchange code for tokens using Slack's specific OAuth flow
    const response = await fetch(slackOAuthProvider.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: slackOAuthProvider.clientId,
        client_secret: slackOAuthProvider.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Token exchange failed");
    }

    // Get actual user ID from session in production
    const userId = "current-user";

    // Store tokens (Slack returns access_token in authed_user or at top level)
    const accessToken = data.authed_user?.access_token || data.access_token;
    await tokenStore.setToken(userId, "slack", {
      accessToken,
      refreshToken: data.refresh_token,
      scope: data.scope,
      tokenType: data.token_type,
    });

    // Clear state cookie and redirect to success page
    return new Response(
      `
      <html>
        <head>
          <title>Slack Connected</title>
          <meta http-equiv="refresh" content="2;url=/" />
        </head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1 style="color: #22c55e;">✓ Slack Connected!</h1>
          <p style="color: #666;">Your Slack workspace has been connected successfully.</p>
          <p style="color: #999; font-size: 14px;">Redirecting...</p>
          <a href="/" style="color: #0066cc;">Return to App</a>
        </body>
      </html>
      `,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": "slack_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        },
      },
    );
  } catch (err) {
    console.error("Slack OAuth error:", err);
    return new Response(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Slack Connection Failed</h1>
          <p style="color: #666;">Unable to complete Slack authorization. Please try again.</p>
          <a href="/api/auth/slack" style="color: #0066cc;">Try Again</a>
        </body>
      </html>
      `,
      {
        status: 500,
        headers: { "Content-Type": "text/html" },
      },
    );
  }
}
