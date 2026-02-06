import { tokenStore } from "../../../../lib/token-store.ts";

const INTEGRATIONS = [
  { id: "gmail", name: "Gmail", icon: "mail" },
  { id: "slack", name: "Slack", icon: "slack" },
  { id: "calendar", name: "Calendar", icon: "calendar" },
  { id: "github", name: "GitHub", icon: "github" },
  { id: "jira", name: "Jira", icon: "jira" },
  { id: "notion", name: "Notion", icon: "notion" },
];

export async function GET(_req: Request): Promise<Response> {
  const userId = "current-user";

  const integrations = await Promise.all(
    INTEGRATIONS.map(async (integration) => {
      const { id, name, icon } = integration;

      return {
        id,
        name,
        icon,
        connected: await tokenStore.isConnected(userId, id),
        connectUrl: `/api/auth/${id}`,
      };
    }),
  );

  return Response.json({ integrations });
}
