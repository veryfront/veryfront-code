import { verifySession } from "../lib/auth.ts";

export async function requireAuth(
  request: Request
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof verifySession>> }
  | { ok: false; response: Response }
> {
  const cookie = request.headers.get("cookie");
  const token = cookie
    ?.split("; ")
    .find((row) => row.startsWith("session="))
    ?.split("=")[1];

  if (!token) {
    return {
      ok: false,
      response: Response.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  const session = await verifySession(token);
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "Invalid session" }, { status: 401 }),
    };
  }

  return { ok: true, session };
}
