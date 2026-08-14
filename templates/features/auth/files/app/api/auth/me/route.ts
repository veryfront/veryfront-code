import { db } from "../../../../lib/db.ts";
import { verify } from "../../../../lib/jwt.ts";

export async function GET(req: Request): Promise<Response> {
  const token = req.headers.get("cookie")?.match(/session=([^;]+)/)?.[1];
  if (!token) return Response.json({ user: null });

  const payload = await verify(token);
  if (!payload) return Response.json({ user: null });

  const user = await db.user.findUnique({ where: { email: payload.email } });
  if (!user) return Response.json({ user: null });

  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
}
