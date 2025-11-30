
import { defineConfig } from "veryfront";
import { verify } from "./lib/jwt.ts";

// Auth Guard Middleware
const authGuard = async (ctx: any, next: any) => {
  const url = new URL(ctx.req.url);
  
  // Define protected paths
  const isProtected = url.pathname.startsWith("/dashboard") || 
                      url.pathname.startsWith("/api/user");

  if (isProtected) {
    // Check for session cookie
    const cookieHeader = ctx.req.headers.get("cookie") || "";
    const match = cookieHeader.match(/session=([^;]+)/);
    const token = match ? match[1] : null;

    if (!token) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return Response.redirect(new URL("/login", ctx.req.url));
    }

    const payload = await verify(token);
    if (!payload) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Invalid token" }, { status: 401 });
      }
      return Response.redirect(new URL("/login", ctx.req.url));
    }

    // Pass user info to next handlers (if framework supports context mutation)
    ctx.user = payload;
  }

  return next();
};

export default defineConfig({
  router: "app",
  middleware: {
    custom: [authGuard],
  },
});
