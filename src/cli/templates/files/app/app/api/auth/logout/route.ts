import { deleteSession } from "../../../../lib/auth.ts";

function getSessionToken(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("session="));

  return sessionCookie?.split("=")[1];
}

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionToken = getSessionToken(request);

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
