/**
 * Twitter OAuth Callback with PKCE
 *
 * Handles the OAuth callback from Twitter, exchanges code for tokens using PKCE,
 * and stores them securely.
 */

import { tokenStore } from "../../../../../lib/token-store.ts";
import { twitterOAuthProvider } from "../../../../../lib/twitter-client.ts";
import { exchangeCodeForTokens } from "../../../../../lib/oauth.ts";

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
          <h1>Twitter Connection Failed</h1>
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

  // Validate state and get code verifier from cookies
  const cookies = req.headers.get("cookie") || "";
  const cookieMap = new Map(
    cookies.split(";").map((c) => {
      const [key, val] = c.trim().split("=");
      return [key, val];
    }),
  );

  const savedState = cookieMap.get("twitter_oauth_state");
  const codeVerifier = cookieMap.get("twitter_code_verifier");

  if (state !== savedState) {
    return new Response("Invalid state parameter", { status: 400 });
  }

  if (!codeVerifier) {
    return new Response("Missing code verifier", { status: 400 });
  }

  try {
    const origin = url.origin;
    const redirectUri = `${origin}${twitterOAuthProvider.callbackPath}`;

    // Exchange code for tokens using PKCE
    const token = await exchangeCodeForTokens(
      twitterOAuthProvider,
      code,
      redirectUri,
      codeVerifier,
    );

    // Get actual user ID from session in production
    const userId = "current-user";

    // Store tokens
    await tokenStore.setToken(userId, "twitter", token);

    // Clear cookies and redirect to success page
    return new Response(
      `
      <html>
        <head>
          <title>Twitter Connected</title>
          <meta http-equiv="refresh" content="2;url=/" />
        </head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1 style="color: #22c55e;">✓ Twitter Connected!</h1>
          <p style="color: #666;">Your Twitter account has been connected successfully.</p>
          <p style="color: #999; font-size: 14px;">Redirecting...</p>
          <a href="/" style="color: #0066cc;">Return to App</a>
        </body>
      </html>
      `,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": [
            "twitter_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            "twitter_code_verifier=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
          ].join(", "),
        },
      },
    );
  } catch (err) {
    console.error("Twitter OAuth error:", err);
    return new Response(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Twitter Connection Failed</h1>
          <p style="color: #666;">Unable to complete Twitter authorization. Please try again.</p>
          <a href="/api/auth/twitter" style="color: #0066cc;">Try Again</a>
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
