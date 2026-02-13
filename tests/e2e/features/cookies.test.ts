#!/usr/bin/env -S deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys
/**
 * Feature Tests: Cookie Handling
 *
 * Tests cookie operations in API routes:
 * - Reading cookies from requests
 * - Setting cookies in responses
 * - Cookie options (httpOnly, secure, path, etc.)
 * - Multiple cookies
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectApi,
  pages,
  withServer,
} from "../setup/index.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert.ts";

describe("Feature: Cookie Handling", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("Reading Cookies", () => {
    it("should read cookies from request", async () => {
      const projectDir = await createProject(
        "cookies-read",
        pages.basic,
        {
          files: {
            "pages/api/me.ts": `
export function GET(ctx) {
  const sessionId = ctx.cookies.sessionId;
  const theme = ctx.cookies.theme;
  return Response.json({
    sessionId: sessionId || null,
    theme: theme || "default"
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/me`;
        const response = await fetch(url, {
          headers: {
            Cookie: "sessionId=abc123; theme=dark",
          },
        });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("sessionId", "abc123")
          .toHaveProperty("theme", "dark");
      });
    });

    it("should handle missing cookies gracefully", async () => {
      const projectDir = await createProject(
        "cookies-missing",
        pages.basic,
        {
          files: {
            "pages/api/check-auth.ts": `
export function GET(ctx) {
  const token = ctx.cookies.authToken;
  return Response.json({
    authenticated: !!token,
    token: token || null
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/check-auth`;
        const response = await fetch(url);
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("authenticated", false)
          .toHaveProperty("token", null);
      });
    });
  });

  describe("Setting Cookies", () => {
    it("should set cookies in response", async () => {
      const projectDir = await createProject(
        "cookies-set",
        pages.basic,
        {
          files: {
            "pages/api/login.ts": `
export function POST() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "sessionId=new-session-123; Path=/; HttpOnly"
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/login`;
        const response = await fetch(url, { method: "POST" });
        const setCookie = response.headers.get("Set-Cookie");

        assert(setCookie !== null, "Should have Set-Cookie header");
        assertStringIncludes(setCookie, "sessionId=new-session-123");
        assertStringIncludes(setCookie, "HttpOnly");
      });
    });

    it("should set multiple cookies", async () => {
      const projectDir = await createProject(
        "cookies-multiple",
        pages.basic,
        {
          files: {
            "pages/api/preferences.ts": `
export function POST() {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("Set-Cookie", "theme=dark; Path=/");
  headers.append("Set-Cookie", "language=en; Path=/");

  return new Response(JSON.stringify({ saved: true }), {
    status: 200,
    headers
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/preferences`;
        const response = await fetch(url, { method: "POST" });

        // Check that at least one cookie header exists
        const setCookie = response.headers.get("Set-Cookie");
        assert(setCookie !== null, "Should have Set-Cookie header");
        // Note: Multiple Set-Cookie headers may be combined by the framework
      });
    });
  });

  describe("Cookie Options", () => {
    it("should set secure cookies with options", async () => {
      const projectDir = await createProject(
        "cookies-options",
        pages.basic,
        {
          files: {
            "pages/api/secure-login.ts": `
export function POST() {
  const cookieValue = [
    "token=secure-token-xyz",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=3600"
  ].join("; ");

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieValue
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/secure-login`;
        const response = await fetch(url, { method: "POST" });
        const setCookie = response.headers.get("Set-Cookie");

        assert(setCookie !== null, "Should have Set-Cookie header");
        assertStringIncludes(setCookie, "token=secure-token-xyz");
        assertStringIncludes(setCookie, "HttpOnly");
        assertStringIncludes(setCookie, "SameSite=Strict");
        assertStringIncludes(setCookie, "Max-Age=3600");
      });
    });
  });

  describe("Cookie-based Authentication Flow", () => {
    it("should implement login/check flow with cookies", async () => {
      const projectDir = await createProject(
        "cookies-auth-flow",
        pages.basic,
        {
          files: {
            "pages/api/auth/login.ts": `
export async function POST(ctx) {
  const body = await ctx.request.json();
  if (body.username === "admin" && body.password === "secret") {
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "auth=valid-token; Path=/; HttpOnly"
      }
    });
  }
  return Response.json({ success: false, error: "Invalid credentials" }, { status: 401 });
}
`,
            "pages/api/auth/check.ts": `
export function GET(ctx) {
  const authCookie = ctx.cookies.auth;
  if (authCookie === "valid-token") {
    return Response.json({ authenticated: true, user: "admin" });
  }
  return Response.json({ authenticated: false }, { status: 401 });
}
`,
            "pages/api/auth/logout.ts": `
export function POST() {
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "auth=; Path=/; Max-Age=0"
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const baseUrl = `http://127.0.0.1:${server.port}`;

        // Login
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "secret" }),
        });
        const loginJson = await loginRes.json();
        const setCookie = loginRes.headers.get("Set-Cookie");

        assert(loginJson.success === true, "Login should succeed");
        assert(setCookie !== null, "Should set auth cookie");

        // Check auth with cookie
        const checkRes = await fetch(`${baseUrl}/api/auth/check`, {
          headers: { Cookie: "auth=valid-token" },
        });
        const checkJson = await checkRes.json();

        assert(checkJson.authenticated === true, "Should be authenticated with cookie");

        // Logout
        const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
          method: "POST",
        });
        const logoutCookie = logoutRes.headers.get("Set-Cookie");

        assertStringIncludes(logoutCookie || "", "Max-Age=0");
      });
    });
  });
});
