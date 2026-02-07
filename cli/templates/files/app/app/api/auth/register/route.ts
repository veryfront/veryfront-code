import { z } from "zod";
import { getEnv } from "veryfront";
import { createSession } from "../../../../lib/auth.ts";
import { createUser } from "../../../../lib/users.ts";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(100),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { email, name, password } = registerSchema.parse(body);

    const user = await createUser({ email, name, password });
    const session = await createSession(user);

    const secureFlag = getEnv("NODE_ENV") === "production" ? "; Secure" : "";
    const cookie = `session=${session.token}; Path=/; HttpOnly; SameSite=Strict${secureFlag}`;

    return Response.json(
      { user, token: session.token },
      {
        status: 201,
        headers: { "Set-Cookie": cookie },
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
