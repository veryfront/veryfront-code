import { db } from "../../../../lib/db.ts";
import { verifyPassword } from "../../../../lib/auth.ts";
import { sign } from "../../../../lib/jwt.ts";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = await sign({ userId: user.id, email: user.email, name: user.name });

    const headers = new Headers({
      "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
    });

    return Response.json(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name },
      },
      { headers },
    );
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
