import { getAuthorizationUrl } from "../../../../lib/oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const redirectUri = `${baseUrl}/api/auth/salesforce/callback`;

  // Generate state for CSRF protection
  const state = crypto.randomUUID();

  const authUrl = getAuthorizationUrl(redirectUri, state);

  return Response.redirect(authUrl);
}
