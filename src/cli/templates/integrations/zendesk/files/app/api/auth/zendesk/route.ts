/**
 * Zendesk OAuth Init Route
 *
 * Redirects to Zendesk OAuth authorization page.
 */

const getEnv = (name: string): string | undefined => {
  if (typeof Deno !== "undefined") {
    // @ts-ignore: Deno global
    return Deno.env.get(name);
  }
  // @ts-ignore: Node process
  return globalThis.process?.env?.[name];
};

export function GET(request: Request): Response {
  const subdomain = getEnv("ZENDESK_SUBDOMAIN");
  const clientId = getEnv("ZENDESK_CLIENT_ID");

  if (!subdomain || !clientId) {
    return Response.json(
      { error: "Zendesk OAuth not configured" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const baseUrl = getEnv("NEXT_PUBLIC_APP_URL") || `${url.protocol}//${url.host}`;
  const redirectUri = `${baseUrl}/api/auth/zendesk/callback`;

  const state = crypto.randomUUID();

  const authUrl = new URL(`https://${subdomain}.zendesk.com/oauth/authorizations/new`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
}
