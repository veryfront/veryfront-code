/**
 * Gmail OAuth Initiation
 *
 * Redirects to Google OAuth consent screen
 */

import { getAuthorizationUrl } from "../../../../lib/oauth.ts";
import { gmailOAuthProvider } from "../../../../lib/gmail-client.ts";

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in a cookie for validation
  const redirectUri = `${origin}${gmailOAuthProvider.callbackPath}`;
  const authUrl = getAuthorizationUrl(gmailOAuthProvider, state, redirectUri);

  // Set state cookie and redirect to Google
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `gmail_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
