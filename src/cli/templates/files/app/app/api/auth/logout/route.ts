import { deleteSession } from "../../../../lib/auth.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const sessionToken = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("session="))
      ?.split("=")[1];

    if (sessionToken) {
      await deleteSession(sessionToken);
    }

    return Response.json(
      { success: true },
      {
        headers: {
          "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        },
      }
    );
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
