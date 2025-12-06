/**
 * Integration Status API
 *
 * Returns the connection status of all configured integrations.
 * Used by the setup guide to show which services are connected.
 */

import { tokenStore } from "../../../../lib/token-store.ts";

// Define available integrations - will be populated based on project config
const INTEGRATIONS = [
  { id: "gmail", name: "Gmail", icon: "mail" },
  { id: "slack", name: "Slack", icon: "slack" },
  { id: "calendar", name: "Calendar", icon: "calendar" },
  { id: "github", name: "GitHub", icon: "github" },
  { id: "jira", name: "Jira", icon: "jira" },
  { id: "notion", name: "Notion", icon: "notion" },
];

export async function GET(_req: Request) {
  // Get actual user ID from session in production
  const userId = "current-user";

  const statuses = await Promise.all(
    INTEGRATIONS.map(async (integration) => {
      const token = await tokenStore.getToken(userId, integration.id);
      return {
        id: integration.id,
        name: integration.name,
        icon: integration.icon,
        connected: !!token,
        connectUrl: `/api/auth/${integration.id}`,
      };
    }),
  );

  return Response.json({ integrations: statuses });
}
