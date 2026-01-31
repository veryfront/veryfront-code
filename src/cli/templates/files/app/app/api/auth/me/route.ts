import { verifySession } from "../../../../lib/auth.ts";
import { getUser } from "../../../../lib/users.ts";

function getSessionTokenFromCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;

  return cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("session="))
    ?.split("=")[1];
}

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionToken = getSessionTokenFromCookie(request.headers.get("cookie"));
    if (!sessionToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = await verifySession(sessionToken);
    if (!session) {
      return Response.json({ error: "Invalid session" }, { status: 401 });
    }

    const user = await getUser(session.userId);
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json({ user });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
