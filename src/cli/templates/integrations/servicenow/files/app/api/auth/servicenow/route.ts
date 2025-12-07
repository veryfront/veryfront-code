/**
 * ServiceNow OAuth Init Route
 *
 * Redirects to ServiceNow OAuth authorization page.
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
  const instance = getEnv("SERVICENOW_INSTANCE");
  const clientId = getEnv("SERVICENOW_CLIENT_ID");

  if (!instance || !clientId) {
    return Response.json(
      { error: "ServiceNow OAuth not configured" },
      { status: 500 },
    );
  }

  const instanceUrl = instance.includes("://") ? instance : `https://${instance}`;

  const url = new URL(request.url);
  const baseUrl = getEnv("NEXT_PUBLIC_APP_URL") || `${url.protocol}//${url.host}`;
  const redirectUri = `${baseUrl}/api/auth/servicenow/callback`;

  const state = crypto.randomUUID();

  const authUrl = new URL(`${instanceUrl}/oauth_auth.do`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
}
