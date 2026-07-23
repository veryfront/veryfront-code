import { oauthTokenStore } from "../../../../lib/oauth-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

const INTEGRATIONS = [
  { id: "gmail", name: "Gmail", icon: "mail" },
  { id: "slack", name: "Slack", icon: "slack" },
  { id: "calendar", name: "Calendar", icon: "calendar" },
  { id: "github", name: "GitHub", icon: "github" },
  { id: "jira", name: "Jira", icon: "jira" },
  { id: "notion", name: "Notion", icon: "notion" },
] as const;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function hasUsableOAuthTokens(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  if (
    typeof token.accessToken !== "string" || token.accessToken.length === 0 ||
    token.accessToken.length > 131072 ||
    token.accessToken.trim() !== token.accessToken
  ) return false;

  const hasRefreshToken = typeof token.refreshToken === "string" &&
    token.refreshToken.length > 0 && token.refreshToken.length <= 131072 &&
    token.refreshToken.trim() === token.refreshToken;
  if (token.refreshToken !== undefined && !hasRefreshToken) return false;
  if (token.expiresAt === undefined) return true;
  if (
    typeof token.expiresAt !== "number" ||
    !Number.isSafeInteger(token.expiresAt) ||
    token.expiresAt < 0
  ) return false;
  return token.expiresAt > now || hasRefreshToken;
}

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserIdFromRequest(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const integrations = await Promise.all(
      INTEGRATIONS.map(async ({ id, name, icon }) => {
        const connected = hasUsableOAuthTokens(
          await oauthTokenStore.getTokens(id, userId),
        );
        return {
          id,
          name,
          icon,
          authType: "oauth2",
          connected,
          connectionState: connected ? "connected" : "disconnected",
          connectUrl: `/api/auth/${id}`,
        };
      }),
    );
    return jsonResponse({ integrations });
  } catch {
    return jsonResponse({
      error: "Integration status is temporarily unavailable",
    }, 503);
  }
}
