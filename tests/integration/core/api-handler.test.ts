/**
 * Tests for API Route Handler
 */

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { APIRouteHandler } from "#veryfront/routing/api/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Track all handlers to clean up after tests
const handlers: APIRouteHandler[] = [];

function createHandler(projectDir: string, adapter?: RuntimeAdapter): APIRouteHandler {
  const handler = new APIRouteHandler(projectDir, adapter);
  handlers.push(handler);
  return handler;
}

async function setupPagesApiDir(projectDir: string, ...segments: string[]): Promise<void> {
  await remove(join(projectDir, "app"), { recursive: true });
  await mkdir(join(projectDir, "pages", "api", ...segments), { recursive: true });
}

async function writeApiFile(
  projectDir: string,
  filePathSegments: string[],
  contents: string,
): Promise<void> {
  await writeTextFile(join(projectDir, "pages", "api", ...filePathSegments), contents);
}

// Wrap entire test suite in a describe block with sanitizers disabled
// This is required because esbuild WASM runtime creates internal timers
// that cannot be cleaned up from user code
describe(
  "API Handler Tests",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Clean up all handlers after each test to prevent interval leaks
    afterEach(() => {
      while (handlers.length) handlers.pop()?.destroy();
    });

    describe("APIRouteHandler", () => {
      describe("Basic routing", () => {
        it("handles simple GET request", async () => {
          await withTestContext("api-handler-get", async (context) => {
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["hello.ts"],
              `
          export const GET = (ctx) => {
            return new Response("Hello from API");
          };
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["resource.ts"],
              `
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
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["limited.ts"],
              `
          export const GET = (ctx) => {
            return new Response("Only GET");
          };
        `,
            );

            await handler.initialize();

            const req = new Request("http://localhost/api/limited", { method: "POST" });
            const res = await handler.handle(req);

            assertExists(res);
            assertEquals(res.status, 405);
          });
        });

        it("returns 404 for non-existent routes", async () => {
          await withTestContext("api-handler-404", async (context) => {
            const handler = createHandler(context.projectDir, await getAdapter());
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
            await setupPagesApiDir(context.projectDir, "users");

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["users", "[id].ts"],
              `
          export const GET = (ctx) => {
            return Response.json({ userId: ctx.params.id });
          };
        `,
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
            await setupPagesApiDir(context.projectDir, "posts", "[id]", "comments");

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["posts", "[id]", "comments", "[commentId].ts"],
              `
          export const GET = (ctx) => {
            return Response.json({ 
              postId: ctx.params.id,
              commentId: ctx.params.commentId 
            });
          };
        `,
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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["[...slug].ts"],
              `
          export const GET = (ctx) => {
            return Response.json({ path: ctx.params.slug });
          };
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["query.ts"],
              `
          export const GET = (ctx) => {
            const name = ctx.query.get("name");
            const age = ctx.query.get("age");
            return Response.json({ name, age });
          };
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["headers.ts"],
              `
          export const GET = (ctx) => {
            const auth = ctx.request.headers.get("authorization");
            const contentType = ctx.request.headers.get("content-type");
            return Response.json({ auth, contentType });
          };
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["json-helper.ts"],
              `
          export const GET = (ctx) => {
            return Response.json({ message: "Hello", timestamp: Date.now() });
          };
        `,
            );

            await handler.initialize();

            const req = new Request("http://localhost/api/json-helper");
            const res = await handler.handle(req);

            assertExists(res);
            assertEquals(res.status, 200);

            const contentType = res.headers.get("content-type");
            assert(
              contentType?.startsWith("application/json"),
              `Expected content-type to start with application/json, got ${contentType}`,
            );

            const data = await res.json();
            assertEquals(data.message, "Hello");
            assertExists(data.timestamp);
          });
        });

        it("handles error response helpers", async () => {
          await withTestContext("api-handler-error-helpers", async (context) => {
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["errors.ts"],
              `
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
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["redirect.ts"],
              `
          export const GET = (ctx) => {
            return new Response(null, {
              status: 302,
              headers: { "location": "/new-location" }
            });
          };
        `,
            );

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
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["error.ts"],
              `
          export const GET = (ctx) => {
            throw new Error("Something went wrong");
          };
        `,
            );

            await handler.initialize();

            const req = new Request("http://localhost/api/error");
            const res = await handler.handle(req);

            assertExists(res);
            assertEquals(res.status, 500);

            const contentType = res.headers.get("content-type") ?? "";
            if (contentType.includes("application/json")) {
              const json = await res.json();
              assertEquals(json.error, "Something went wrong");
              assertExists(json.stack);
              return;
            }

            const text = await res.text();
            assertExists(text);
          });
        });

        it("handles async errors", async () => {
          await withTestContext("api-handler-async-error", async (context) => {
            await setupPagesApiDir(context.projectDir);

            const handler = createHandler(context.projectDir, await getAdapter());

            await writeApiFile(
              context.projectDir,
              ["async-error.ts"],
              `
          export const GET = async (ctx) => {
            await delay(10);
            throw new Error("Async error");
          };
        `,
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
