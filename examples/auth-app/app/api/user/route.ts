
import { verify } from "../../../lib/jwt.ts";

export async function GET(req: Request) {
  // Note: Middleware handles the auth check, but we can double check or get user info here
  // In a real app with proper context passing, we might get user from ctx
  
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/session=([^;]+)/);
  const token = match ? match[1] : null;
  
  // Should be guaranteed by middleware if config is correct, but safe to check
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verify(token);
  
  return Response.json({
    secretData: "This is protected data only visible to logged in users.",
    user: payload,
    timestamp: Date.now()
  });
}
