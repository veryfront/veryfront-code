/**
 * GitHub OAuth Callback
 *
 * Handles the OAuth callback from GitHub, exchanges code for tokens,
 * and stores them securely.
 */

import { tokenStore } from "../../../../../lib/token-store.ts";
import { githubOAuthProvider } from "../../../../../lib/github-client.ts";

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
          <h1>GitHub Connection Failed</h1>
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
    .find((c) => c.trim().startsWith("github_oauth_state="));
  const savedState = stateCookie?.split("=")[1]?.trim();

  if (state !== savedState) {
    return new Response("Invalid state parameter", { status: 400 });
  }

  try {
    const origin = url.origin;
    const redirectUri = `${origin}${githubOAuthProvider.callbackPath}`;

    // Exchange code for tokens
    const response = await fetch(githubOAuthProvider.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: githubOAuthProvider.clientId,
        client_secret: githubOAuthProvider.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    // Get actual user ID from session in production
    const userId = "current-user";

    // Store tokens
    await tokenStore.setToken(userId, "github", {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope,
      tokenType: data.token_type,
    });

    // Clear state cookie and redirect to success page
    return new Response(
      `
      <html>
        <head>
          <title>GitHub Connected</title>
          <meta http-equiv="refresh" content="2;url=/" />
        </head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1 style="color: #22c55e;">✓ GitHub Connected!</h1>
          <p style="color: #666;">Your GitHub account has been connected successfully.</p>
          <p style="color: #999; font-size: 14px;">Redirecting...</p>
          <a href="/" style="color: #0066cc;">Return to App</a>
        </body>
      </html>
      `,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": "github_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        },
      },
    );
  } catch (err) {
    console.error("GitHub OAuth error:", err);
    return new Response(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>GitHub Connection Failed</h1>
          <p style="color: #666;">Unable to complete GitHub authorization. Please try again.</p>
          <a href="/api/auth/github" style="color: #0066cc;">Try Again</a>
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
