import { z } from "zod";
import { createUser } from "../../../../lib/users.ts";
import { createSession } from "../../../../lib/auth.ts";
import { getEnv } from "veryfront/platform";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(100),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, name, password } = registerSchema.parse(body);

    const user = await createUser({ email, name, password });
    const session = await createSession(user as any);

    const isProduction = getEnv("NODE_ENV") === "production";
    const secureFlag = isProduction ? "; Secure" : "";

    return Response.json(
      { user, token: session.token },
      {
        status: 201,
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
