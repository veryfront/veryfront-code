/**
 * App template - API routes
 */

import type { TemplateFile } from "../blog.ts";

export const appApiTemplates: TemplateFile[] = [
  {
    path: "app/api/auth/login/route.ts",
    content: `import { z } from "zod";
import { createSession } from "../../../../lib/auth";
import { validatePassword } from "../../../../lib/users";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    // Validate credentials (replace with real DB lookup)
    const user = await validatePassword(email, password);
    if (!user) {
      return Response.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Create session
    const session = await createSession(user);

    // In production, ensure Secure flag is set for HTTPS-only transmission
    const isProduction = Deno.env.get("NODE_ENV") === "production";
    const secureFlagvalue = isProduction ? "; Secure" : "";

    return Response.json(
      { user, token: session.token },
      {
        headers: {
          "Set-Cookie": \`session=\${session.token}; Path=/; HttpOnly; SameSite=Strict\${secureFlagvalue}\`,
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

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}`,
  },
  {
    path: "app/api/users/route.ts",
    content: `import { z } from "zod";
import { requireAuth } from "../../../middleware/auth";
import { getUsers, createUser } from "../../../lib/users";

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
}`,
  },
  {
    path: "app/api/stats/route.ts",
    content: `import { requireAuth } from "../../../middleware/auth";
import { getStats } from "../../../lib/stats";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return Response.json(
      { error: "userId parameter required" },
      { status: 400 }
    );
  }

  const stats = await getStats(userId);

  return Response.json({ stats });
}`,
  },
];
