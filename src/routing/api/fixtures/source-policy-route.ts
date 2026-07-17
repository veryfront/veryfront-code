import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";

export function GET(): Response {
  return Response.json(getActiveSourceIntegrationPolicy());
}
