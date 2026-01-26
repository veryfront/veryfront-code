import { requireAuth } from "../../../middleware/auth.ts";
import { getStats } from "../../../lib/stats.ts";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return Response.json({ error: "userId parameter required" }, { status: 400 });
  }

  const stats = await getStats(userId);
  return Response.json({ stats });
}
