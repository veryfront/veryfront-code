import { verifySession } from "../../../../lib/auth.ts";
import { getUser } from "../../../../lib/users.ts";

export async function GET(request: Request): Promise<Response> {
  try {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const sessionToken = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("session="))
      ?.split("=")[1];

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
