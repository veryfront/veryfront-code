/**
 * Tests for API Route Handler
 *
 * Driven in-process through the same request pipeline the dev server serves,
 * so routes are exercised behind the real handler chain (CSRF included)
 * instead of a hand-built handler context.
 */

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withInProcessProject } from "../../_helpers/in-process-project.ts";

/**
 * The pipeline enforces double-submit CSRF on mutating methods, exactly as it
 * does over a socket; these headers are what a browser would send back.
 */
const CSRF_TOKEN = "in-process-csrf-token";
const CSRF_HEADERS = {
  cookie: `__Host-vf_csrf=${CSRF_TOKEN}`,
  "x-csrf-token": CSRF_TOKEN,
};

function mutating(method: string): RequestInit {
  return { method, headers: CSRF_HEADERS };
}

describe("API Handler Tests", () => {
  describe("APIRouteHandler", () => {
    describe("Basic routing", () => {
      it("handles simple GET request", async () => {
        await withInProcessProject("api-handler-get", {
          files: {
            "pages/api/hello.ts": `
          export const GET = (ctx) => {
            return new Response("Hello from API");
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/hello");

          assertExists(res);
          assertEquals(res.status, 200);
          assertEquals(await res.text(), "Hello from API");
        });
      });

      it("handles multiple HTTP methods", async () => {
        await withInProcessProject("api-handler-methods", {
          files: {
            "pages/api/resource.ts": `
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
          },
        }, async (project) => {
          for (const method of ["GET", "POST", "PUT", "DELETE"]) {
            const res = await project.handle("/api/resource", mutating(method));

            assertExists(res);
            assertEquals(res.status, 200);
            const data = await res.json();
            assertEquals(data.method, method);
          }
        });
      });

      it("returns 405 for unsupported methods", async () => {
        await withInProcessProject("api-handler-405", {
          files: {
            "pages/api/limited.ts": `
          export const GET = (ctx) => {
            return new Response("Only GET");
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/limited", mutating("POST"));
          await res.body?.cancel();

          assertExists(res);
          assertEquals(res.status, 405);
        });
      });

      it("returns 404 for non-existent routes", async () => {
        await withInProcessProject("api-handler-404", {}, async (project) => {
          const res = await project.handle("/api/nonexistent");
          await res.body?.cancel();

          assertExists(res);
          assertEquals(res.status, 404);
        });
      });
    });

    describe("Dynamic routes", () => {
      it("handles single dynamic segment", async () => {
        await withInProcessProject("api-handler-dynamic-single", {
          files: {
            "pages/api/users/[id].ts": `
          export const GET = (ctx) => {
            return Response.json({ userId: ctx.params.id });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/users/123");

          assertExists(res);
          assertEquals(res.status, 200);
          const data = await res.json();
          assertEquals(data.userId, "123");
        });
      });

      it("handles multiple dynamic segments", async () => {
        await withInProcessProject("api-handler-dynamic-multiple", {
          files: {
            "pages/api/posts/[id]/comments/[commentId].ts": `
          export const GET = (ctx) => {
            return Response.json({
              postId: ctx.params.id,
              commentId: ctx.params.commentId
            });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/posts/456/comments/789");

          assertExists(res);
          assertEquals(res.status, 200);
          const data = await res.json();
          assertEquals(data.postId, "456");
          assertEquals(data.commentId, "789");
        });
      });

      it("handles catch-all routes", async () => {
        await withInProcessProject("api-handler-catch-all", {
          files: {
            "pages/api/[...slug].ts": `
          export const GET = (ctx) => {
            return Response.json({ path: ctx.params.slug });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/deep/nested/path");

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
        await withInProcessProject("api-handler-query", {
          files: {
            "pages/api/query.ts": `
          export const GET = (ctx) => {
            const name = ctx.query.get("name");
            const age = ctx.query.get("age");
            return Response.json({ name, age });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/query?name=John&age=30");

          assertExists(res);
          assertEquals(res.status, 200);
          const data = await res.json();
          assertEquals(data.name, "John");
          assertEquals(data.age, "30");
        });
      });

      it("provides request headers", async () => {
        await withInProcessProject("api-handler-headers", {
          files: {
            "pages/api/headers.ts": `
          export const GET = (ctx) => {
            const auth = ctx.request.headers.get("authorization");
            const contentType = ctx.request.headers.get("content-type");
            return Response.json({ auth, contentType });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/headers", {
            headers: {
              authorization: "Bearer token123",
              "content-type": "application/json",
            },
          });

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
        await withInProcessProject("api-handler-json-helper", {
          files: {
            "pages/api/json-helper.ts": `
          export const GET = (ctx) => {
            return Response.json({ message: "Hello", timestamp: Date.now() });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/json-helper");

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
        await withInProcessProject("api-handler-error-helpers", {
          files: {
            "pages/api/errors.ts": `
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
          },
        }, async (project) => {
          const tests = [
            { type: "bad", status: 400, message: "Invalid input" },
            { type: "unauth", status: 401, message: "Not authenticated" },
            { type: "forbid", status: 403, message: "Access denied" },
            { type: "notfound", status: 404, message: "Resource not found" },
            { type: "error", status: 500, message: "Internal error" },
          ];

          for (const test of tests) {
            const res = await project.handle(`/api/errors?type=${test.type}`);

            assertExists(res);
            assertEquals(res.status, test.status);
            const data = await res.json();
            assertEquals(data.error, test.message);
          }
        });
      });

      it("handles redirect helper", async () => {
        await withInProcessProject("api-handler-redirect", {
          files: {
            "pages/api/redirect.ts": `
          export const GET = (ctx) => {
            return new Response(null, {
              status: 302,
              headers: { "location": "/new-location" }
            });
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/redirect");
          await res.body?.cancel();

          assertExists(res);
          assertEquals(res.status, 302);
          assertEquals(res.headers.get("location"), "/new-location");
        });
      });
    });

    describe("Error handling", () => {
      it("handles route handler errors gracefully", async () => {
        await withInProcessProject("api-handler-error-handling", {
          files: {
            "pages/api/error.ts": `
          export const GET = (ctx) => {
            throw new Error("Something went wrong");
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/error");

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
        await withInProcessProject("api-handler-async-error", {
          files: {
            "pages/api/async-error.ts": `
          export const GET = async (ctx) => {
            await delay(10);
            throw new Error("Async error");
          };
        `,
          },
        }, async (project) => {
          const res = await project.handle("/api/async-error");
          await res.body?.cancel();

          assertExists(res);
          assertEquals(res.status, 500);
        });
      });
    });
  });
});
