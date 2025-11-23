/**
 * App template - Middleware
 */

import type { TemplateFile } from "../blog.ts";

export const appMiddlewareTemplates: TemplateFile[] = [
  {
    path: "middleware/auth.ts",
    content: `import { verifySession } from "../lib/auth";

export async function requireAuth(request: Request) {
  const cookie = request.headers.get("cookie");
  const token = cookie?.split("; ")
    .find(row => row.startsWith("session="))
    ?.split("=")[1];

  if (!token) {
    return {
      ok: false,
      response: Response.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  const session = await verifySession(token);
  if (!session) {
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid session" },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    session,
  };
}`,
  },
];
