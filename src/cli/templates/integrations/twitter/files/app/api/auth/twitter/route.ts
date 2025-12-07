/**
 * Twitter OAuth Initiation with PKCE
 *
 * Redirects to Twitter OAuth consent screen with PKCE challenge
 */

import {
  generateCodeChallenge,
  generateCodeVerifier,
  getAuthorizationUrl,
} from "../../../../lib/oauth.ts";
import { twitterOAuthProvider } from "../../../../lib/twitter-client.ts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store state and code verifier in cookies for validation
  const redirectUri = `${origin}${twitterOAuthProvider.callbackPath}`;
  const authUrl = await getAuthorizationUrl(
    twitterOAuthProvider,
    state,
    redirectUri,
    codeChallenge,
  );

  // Set cookies and redirect to Twitter
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": [
        `twitter_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
        `twitter_code_verifier=${codeVerifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      ].join(", "),
    },
  });
}
