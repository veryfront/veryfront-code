import { tokenStore } from "../../../../lib/token-store.ts";

// Services to check - add/remove based on your integrations
// Gmail and Calendar share OAuth credentials, so we check both separately
const SERVICES = [
  { id: "gmail", name: "Gmail" },
  { id: "calendar", name: "Calendar" },
  // { id: 'slack', name: 'Slack' },
  // { id: 'github', name: 'GitHub' },
];

export async function GET() {
  // In production, get userId from session/cookie
  // For development, we use a default user
  const userId = "current-user";

  const services: Record<string, boolean> = {};

  for (const service of SERVICES) {
    try {
      services[service.id] = await tokenStore.isConnected(userId, service.id);
    } catch {
      services[service.id] = false;
    }
  }

  return new Response(JSON.stringify({ services }), {
    headers: { "Content-Type": "application/json" },
  });
}
