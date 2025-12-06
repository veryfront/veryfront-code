/**
 * Slack OAuth Initiation
 *
 * Redirects to Slack OAuth consent screen
 */

import { getAuthorizationUrl } from "../../../../lib/oauth.ts";
import { slackOAuthProvider } from "../../../../lib/slack-client.ts";

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in a cookie for validation
  const redirectUri = `${origin}${slackOAuthProvider.callbackPath}`;
  const authUrl = getAuthorizationUrl(slackOAuthProvider, state, redirectUri);

  // Set state cookie and redirect to Slack
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `slack_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
