
import { tokenStore } from "../../../../lib/token-store.ts";

const INTEGRATIONS = [
  { id: "gmail", name: "Gmail", icon: "mail" },
  { id: "slack", name: "Slack", icon: "slack" },
  { id: "calendar", name: "Calendar", icon: "calendar" },
  { id: "github", name: "GitHub", icon: "github" },
  { id: "jira", name: "Jira", icon: "jira" },
  { id: "notion", name: "Notion", icon: "notion" },
];

export async function GET(_req: Request) {
  const userId = "current-user";

  const statuses = await Promise.all(
    INTEGRATIONS.map(async (integration) => {
      const connected = await tokenStore.isConnected(userId, integration.id);
      return {
        id: integration.id,
        name: integration.name,
        icon: integration.icon,
        connected,
        connectUrl: `/api/auth/${integration.id}`,
      };
    }),
  );

  return Response.json({ integrations: statuses });
}
