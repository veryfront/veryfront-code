import { getOAuthStorageStatus } from "../../../../lib/oauth-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

/** Return authenticated, adapter-reported OAuth storage capabilities. */
export async function GET(request: Request): Promise<Response> {
  const userId = await requireUserIdFromRequest(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const status = getOAuthStorageStatus();
  return Response.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
