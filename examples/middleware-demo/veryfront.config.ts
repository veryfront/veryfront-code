import { defineConfig } from "veryfront";
import { rateLimit } from "veryfront/middleware";

// Simple logger middleware
const logger = async (ctx: any, next: any) => {
  const start = Date.now();
  console.log(`[Middleware] Request: ${ctx.req.method} ${ctx.req.url}`);

  const res = await next();

  const ms = Date.now() - start;
  console.log(`[Middleware] Response: ${ctx.req.url} took ${ms}ms`);

  return res;
};

// Auth protection middleware
const authGuard = (ctx: any, next: any) => {
  const url = new URL(ctx.req.url);

  // Protect /protected route
  if (url.pathname.startsWith("/protected")) {
    const authHeader = ctx.req.headers.get("Authorization");

    if (!authHeader || authHeader !== "Bearer secret") {
      return new Response("Unauthorized: Missing or invalid token", {
        status: 401,
      });
    }
  }

  return next();
};

export default defineConfig({
  router: "app",
  middleware: {
    custom: [logger, rateLimit({ maxRequests: 10 }), authGuard],
  },
});
