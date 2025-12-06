/**
 * GitHub OAuth Initiation
 *
 * Redirects to GitHub OAuth consent screen
 */

import { getAuthorizationUrl } from "../../../../lib/oauth.ts";
import { githubOAuthProvider } from "../../../../lib/github-client.ts";

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in a cookie for validation
  const redirectUri = `${origin}${githubOAuthProvider.callbackPath}`;
  const authUrl = getAuthorizationUrl(githubOAuthProvider, state, redirectUri);

  // Set state cookie and redirect to GitHub
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `github_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
