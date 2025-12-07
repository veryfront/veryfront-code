/**
 * Google Sheets OAuth Initiation
 *
 * Redirects to Google OAuth consent screen for Sheets access
 */

import { getAuthorizationUrl } from "../../../../lib/oauth.ts";
import { sheetsOAuthProvider } from "../../../../lib/sheets-client.ts";

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in a cookie for validation
  const redirectUri = `${origin}${sheetsOAuthProvider.callbackPath}`;
  const authUrl = getAuthorizationUrl(sheetsOAuthProvider, state, redirectUri);

  // Set state cookie and redirect to Google
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `sheets_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
