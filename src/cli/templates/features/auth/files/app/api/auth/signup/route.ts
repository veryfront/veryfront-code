import { db } from "../../../../lib/db.ts";
import { hashPassword } from "../../../../lib/auth.ts";
import { sign } from "../../../../lib/jwt.ts";

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return Response.json({ error: "User already exists" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const newUser = await db.user.create({
      data: { email, passwordHash, name },
    });

    const token = await sign({ userId: newUser.id, email: newUser.email, name: newUser.name });

    const headers = new Headers();
    headers.set(
      "Set-Cookie",
      `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
    );

    return Response.json({
      success: true,
      user: { id: newUser.id, email: newUser.email, name: newUser.name },
    }, { headers });
  } catch (_error) {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
