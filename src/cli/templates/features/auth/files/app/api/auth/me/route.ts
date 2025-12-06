import { verify } from "../../../../lib/jwt.ts";
import { db } from "../../../../lib/db.ts";

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/session=([^;]+)/);
  const token = match ? match[1] : null;

  if (!token) {
    return Response.json({ user: null });
  }

  const payload = await verify(token);
  if (!payload) {
    return Response.json({ user: null });
  }

  // Fetch fresh user data from DB
  const user = await db.user.findUnique({ where: { email: payload.email } });

  if (!user) {
    return Response.json({ user: null });
  }

  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
}
