/**
 * Bitbucket OAuth Initiation
 *
 * Redirects to Bitbucket OAuth consent screen
 */

import { getAuthorizationUrl } from "../../../../lib/oauth.ts";
import { bitbucketOAuthProvider } from "../../../../lib/bitbucket-client.ts";

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in a cookie for validation
  const redirectUri = `${origin}${bitbucketOAuthProvider.callbackPath}`;
  const authUrl = getAuthorizationUrl(bitbucketOAuthProvider, state, redirectUri);

  // Set state cookie and redirect to Bitbucket
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `bitbucket_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
