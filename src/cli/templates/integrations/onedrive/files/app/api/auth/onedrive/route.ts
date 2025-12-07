import { getAuthorizationUrl } from "../../../../lib/oauth.ts";

export function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const redirectUri = `${baseUrl}/api/auth/onedrive/callback`;

  // Generate state for CSRF protection
  const state = crypto.randomUUID();

  const authUrl = getAuthorizationUrl(redirectUri, state);

  return Response.redirect(authUrl);
}
