import { setZendeskTokens } from "../../../../../lib/token-store.ts";

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
    console.error("Zendesk OAuth error:", error, errorDescription);
    const description = encodeURIComponent(errorDescription ?? error);
    return Response.redirect(
      `${baseUrl}/?error=zendesk_oauth_failed&description=${description}`,
      302,
    );
  }

  if (!code) return Response.redirect(`${baseUrl}/?error=no_code`, 302);

  const subdomain = getEnv("ZENDESK_SUBDOMAIN");
  const clientId = getEnv("ZENDESK_CLIENT_ID");
  const clientSecret = getEnv("ZENDESK_CLIENT_SECRET");

  if (!subdomain || !clientId || !clientSecret) {
    return Response.redirect(`${baseUrl}/?error=zendesk_not_configured`, 302);
  }

  const redirectUri = `${baseUrl}/api/auth/zendesk/callback`;

  try {
    const tokenResponse = await fetch(
      `https://${subdomain}.zendesk.com/oauth/tokens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          scope: "read write",
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Zendesk token exchange failed:", errorText);
      return Response.redirect(`${baseUrl}/?error=token_exchange_failed`, 302);
    }

    const tokens = await tokenResponse.json();

    await setZendeskTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
      subdomain,
    });

    return Response.redirect(`${baseUrl}/?connected=zendesk`, 302);
  } catch (err) {
    console.error("Zendesk OAuth error:", err);
    return Response.redirect(`${baseUrl}/?error=zendesk_oauth_failed`, 302);
  }
}
