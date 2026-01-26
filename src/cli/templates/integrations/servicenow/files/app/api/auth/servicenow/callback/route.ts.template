import { setServiceNowTokens } from "../../../../../lib/token-store.ts";

function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined") {
    // @ts-ignore: Deno global
    return Deno.env.get(name);
  }
  // @ts-ignore: Node process
  return globalThis.process?.env?.[name];
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const baseUrl = getEnv("NEXT_PUBLIC_APP_URL") ?? `${url.protocol}//${url.host}`;

  if (error) {
    console.error("ServiceNow OAuth error:", error, errorDescription);
    const description = encodeURIComponent(errorDescription ?? error);
    return Response.redirect(
      `${baseUrl}/?error=servicenow_oauth_failed&description=${description}`,
      302,
    );
  }

  if (!code) return Response.redirect(`${baseUrl}/?error=no_code`, 302);

  const instance = getEnv("SERVICENOW_INSTANCE");
  const clientId = getEnv("SERVICENOW_CLIENT_ID");
  const clientSecret = getEnv("SERVICENOW_CLIENT_SECRET");

  if (!instance || !clientId || !clientSecret) {
    return Response.redirect(`${baseUrl}/?error=servicenow_not_configured`, 302);
  }

  const instanceUrl = instance.includes("://") ? instance : `https://${instance}`;
  const redirectUri = `${baseUrl}/api/auth/servicenow/callback`;

  try {
    const tokenResponse = await fetch(`${instanceUrl}/oauth_token.do`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("ServiceNow token exchange failed:", await tokenResponse.text());
      return Response.redirect(`${baseUrl}/?error=token_exchange_failed`, 302);
    }

    const tokens = await tokenResponse.json();

    await setServiceNowTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      instanceUrl,
    });

    return Response.redirect(`${baseUrl}/?connected=servicenow`, 302);
  } catch (error) {
    console.error("ServiceNow OAuth error:", err);
    return Response.redirect(`${baseUrl}/?error=servicenow_oauth_failed`, 302);
  }
}
