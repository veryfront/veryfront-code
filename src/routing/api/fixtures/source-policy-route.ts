import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";

// Keep this fixture valid JavaScript as well as TypeScript: prepared-worker
// protocol tests send the exact source bytes after a production preparation
// boundary, where type syntax has already been erased.
export function GET() {
  return Response.json(getActiveSourceIntegrationPolicy());
}
