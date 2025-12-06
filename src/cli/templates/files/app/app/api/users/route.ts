import { z } from "zod";
import { requireAuth } from "../../../middleware/auth.ts";
import { getUsers, createUser } from "../../../lib/users.ts";

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["user", "admin"]).default("user"),
});

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const users = await getUsers();
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const data = userSchema.parse(body);

    const user = await createUser(data);
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      );
    }

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}