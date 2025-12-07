// Notion OAuth utilities

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    throw new Error("NOTION_CLIENT_ID environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    owner: "user",
  });

  if (state) {
    params.set("state", state);
  }

  return `${NOTION_AUTH_URL}?${params.toString()}`;
}

export interface NotionTokenResponse {
  access_token: string;
  token_type: "bearer";
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  duplicated_template_id?: string;
  owner: {
    type: "user" | "workspace";
    user?: {
      id: string;
      name?: string;
      avatar_url?: string;
    };
  };
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<NotionTokenResponse> {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("NOTION_CLIENT_ID and NOTION_CLIENT_SECRET must be set");
  }

  // Notion uses Basic auth for token exchange
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
