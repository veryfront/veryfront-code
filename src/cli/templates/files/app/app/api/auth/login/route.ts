import { z } from "zod";
import { getEnv } from "veryfront/platform";
import { createSession } from "../../../../lib/auth.ts";
import { validatePassword } from "../../../../lib/users.ts";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    const user = await validatePassword(email, password);
    if (!user) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const session = await createSession(user);
    const secureFlag = getEnv("NODE_ENV") === "production" ? "; Secure" : "";

    return Response.json(
      { user, token: session.token },
      {
        headers: {
          "Set-Cookie": `session=${session.token}; Path=/; HttpOnly; SameSite=Strict${secureFlag}`,
        },
      }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      );
    }

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
