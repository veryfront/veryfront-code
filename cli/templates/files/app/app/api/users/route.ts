import { z } from "zod";
import { requireAuth } from "../../../middleware/auth.ts";
import { createUser, getUsers } from "../../../lib/users.ts";

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["user", "admin"]).default("user"),
});

async function requireAuthOrReturn(request: Request): Promise<Response | null> {
  const auth = await requireAuth(request);
  return auth.ok ? null : auth.response;
}

export async function GET(request: Request): Promise<Response> {
  const authResponse = await requireAuthOrReturn(request);
  if (authResponse) return authResponse;

  const users = await getUsers();
  return Response.json({ users });
}

export async function POST(request: Request): Promise<Response> {
  const authResponse = await requireAuthOrReturn(request);
  if (authResponse) return authResponse;

  try {
    const data = userSchema.parse(await request.json());
    const user = await createUser(data);
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 },
      );
    }

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
