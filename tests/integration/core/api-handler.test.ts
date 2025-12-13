
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterEach, beforeAll, describe, it } from "std/testing/bdd.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { APIRouteHandler } from "@veryfront/routing/api/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

const handlers: APIRouteHandler[] = [];

function createHandler(projectDir: string, adapter?: typeof denoAdapter): APIRouteHandler {
  const handler = new APIRouteHandler(projectDir, adapter);
  handlers.push(handler);
  return handler;
}

// This is required because esbuild WASM runtime creates internal timers
describe(
  "API Handler Tests",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    afterEach(() => {
      while (handlers.length > 0) {
        const handler = handlers.pop();
        handler?.destroy();
      }
    });

    describe("APIRouteHandler", () => {
  describe("Basic routing", () => {
    it("handles simple GET request", async () => {
      await withTestContext("api-handler-get", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return new Response("Hello from API");
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "hello.ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/hello");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        assertEquals(await res.text(), "Hello from API");
      });
    });

    it("handles multiple HTTP methods", async () => {
      await withTestContext("api-handler-methods", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return Response.json({ method: "GET" });
          };
          
          export const POST = (ctx) => {
            return Response.json({ method: "POST" });
          };
          
          export const PUT = (ctx) => {
            return Response.json({ method: "PUT" });
          };
          
          export const DELETE = (ctx) => {
            return Response.json({ method: "DELETE" });
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "resource.ts"), apiFile);

        await handler.initialize();

        for (const method of ["GET", "POST", "PUT", "DELETE"]) {
          const req = new Request("http://localhost/api/resource", { method });
          const res = await handler.handle(req);

          assertExists(res);
          assertEquals(res.status, 200);
          const data = await res.json();
          assertEquals(data.method, method);
        }
      });
    });

    it("returns 405 for unsupported methods", async () => {
      await withTestContext("api-handler-405", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return new Response("Only GET");
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "limited.ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/limited", {
          method: "POST",
        });
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 405);
      });
    });

    it("returns 404 for non-existent routes", async () => {
      await withTestContext("api-handler-404", async (context) => {
        const handler = createHandler(context.projectDir, denoAdapter);
        await handler.initialize();

        const req = new Request("http://localhost/api/nonexistent");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 404);
      });
    });
  });

  describe("Dynamic routes", () => {
    it("handles single dynamic segment", async () => {
      await withTestContext("api-handler-dynamic-single", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api", "users"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return Response.json({ userId: ctx.params.id });
          };
        `;
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "users", "[id].ts"),
          apiFile,
        );

        await handler.initialize();

        const req = new Request("http://localhost/api/users/123");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.userId, "123");
      });
    });

    it("handles multiple dynamic segments", async () => {
      await withTestContext("api-handler-dynamic-multiple", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api", "posts", "[id]", "comments"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return Response.json({ 
              postId: ctx.params.id,
              commentId: ctx.params.commentId 
            });
          };
        `;
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "posts", "[id]", "comments", "[commentId].ts"),
          apiFile,
        );

        await handler.initialize();

        const req = new Request("http://localhost/api/posts/456/comments/789");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.postId, "456");
        assertEquals(data.commentId, "789");
      });
    });

    it("handles catch-all routes", async () => {
      await withTestContext("api-handler-catch-all", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return Response.json({ path: ctx.params.slug });
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "[...slug].ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/deep/nested/path");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        const data = await res.json();
        assert(Array.isArray(data.path));
        assertEquals(data.path, ["deep", "nested", "path"]);
      });
    });
  });

  describe("Request context", () => {
    it("provides query parameters", async () => {
      await withTestContext("api-handler-query", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            const name = ctx.query.get("name");
            const age = ctx.query.get("age");
            return Response.json({ name, age });
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "query.ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/query?name=John&age=30");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.name, "John");
        assertEquals(data.age, "30");
      });
    });

    it("provides request headers", async () => {
      await withTestContext("api-handler-headers", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            const auth = ctx.request.headers.get("authorization");
            const contentType = ctx.request.headers.get("content-type");
            return Response.json({ auth, contentType });
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "headers.ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/headers", {
          headers: {
            authorization: "Bearer token123",
            "content-type": "application/json",
          },
        });
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.auth, "Bearer token123");
        assertEquals(data.contentType, "application/json");
      });
    });
  });

  describe("Response helpers", () => {
    it("handles json response helper", async () => {
      await withTestContext("api-handler-json-helper", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return Response.json({ message: "Hello", timestamp: Date.now() });
          };
        `;
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "json-helper.ts"),
          apiFile,
        );

        await handler.initialize();

        const req = new Request("http://localhost/api/json-helper");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 200);
        assertEquals(res.headers.get("content-type"), "application/json");
        const data = await res.json();
        assertEquals(data.message, "Hello");
        assertExists(data.timestamp);
      });
    });

    it("handles error response helpers", async () => {
      await withTestContext("api-handler-error-helpers", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            const type = ctx.query.get("type");
            
            switch (type) {
              case "bad": return Response.json({ error: "Invalid input" }, { status: 400 });
              case "unauth": return Response.json({ error: "Not authenticated" }, { status: 401 });
              case "forbid": return Response.json({ error: "Access denied" }, { status: 403 });
              case "notfound": return Response.json({ error: "Resource not found" }, { status: 404 });
              case "error": return Response.json({ error: "Internal error" }, { status: 500 });
              default: return new Response("Unknown type");
            }
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "errors.ts"), apiFile);

        await handler.initialize();

        const tests = [
          { type: "bad", status: 400, message: "Invalid input" },
          { type: "unauth", status: 401, message: "Not authenticated" },
          { type: "forbid", status: 403, message: "Access denied" },
          { type: "notfound", status: 404, message: "Resource not found" },
          { type: "error", status: 500, message: "Internal error" },
        ];

        for (const test of tests) {
          const req = new Request(`http://localhost/api/errors?type=${test.type}`);
          const res = await handler.handle(req);

          assertExists(res);
          assertEquals(res.status, test.status);
          const data = await res.json();
          assertEquals(data.error, test.message);
        }
      });
    });

    it("handles redirect helper", async () => {
      await withTestContext("api-handler-redirect", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            return new Response(null, {
              status: 302,
              headers: { "location": "/new-location" }
            });
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "redirect.ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/redirect");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 302);
        assertEquals(res.headers.get("location"), "/new-location");
      });
    });
  });

  describe("Error handling", () => {
    it("handles route handler errors gracefully", async () => {
      await withTestContext("api-handler-error-handling", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = (ctx) => {
            throw new Error("Something went wrong");
          };
        `;
        await Deno.writeTextFile(join(context.projectDir, "pages", "api", "error.ts"), apiFile);

        await handler.initialize();

        const req = new Request("http://localhost/api/error");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 500);
        const json = await res.json();
        assertEquals(json.error, "Something went wrong");
        assertExists(json.stack);
      });
    });

    it("handles async errors", async () => {
      await withTestContext("api-handler-async-error", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        const handler = createHandler(context.projectDir, denoAdapter);

        const apiFile = `
          export const GET = async (ctx) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            throw new Error("Async error");
          };
        `;
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "async-error.ts"),
          apiFile,
        );

        await handler.initialize();

        const req = new Request("http://localhost/api/async-error");
        const res = await handler.handle(req);

        assertExists(res);
        assertEquals(res.status, 500);
      });
    });
  });
});
},
);
