#!/usr/bin/env -S deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys
/**
 * Feature Tests: API Route Methods
 *
 * Tests HTTP methods beyond GET:
 * - POST with JSON body
 * - PUT for updates
 * - DELETE for removal
 * - Request body parsing
 * - Method-specific handlers
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertStatus,
  createProject,
  ensureBinaryCompiled,
  expectApi,
  fetchJson,
  pages,
  withServer,
} from "../setup/index.ts";
import { assert } from "#veryfront/testing/assert.ts";

describe("Feature: API Route Methods", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("POST Requests", () => {
    it("should handle POST with JSON body", async () => {
      const projectDir = await createProject(
        "api-post-json",
        pages.basic,
        {
          files: {
            "pages/api/users.ts": `
export async function POST(ctx) {
  const body = await ctx.request.json();
  return Response.json({
    created: true,
    user: { id: "new-123", name: body.name, email: body.email }
  }, { status: 201 });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/users`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
        });
        const json = await response.json();

        assertStatus(response, 201);
        expectApi(response, json)
          .toHaveProperty("created", true)
          .toHaveProperty("user");
        assert(json.user.name === "Alice", "Should have user name");
        assert(json.user.email === "alice@example.com", "Should have user email");
      });
    });

    it("should handle POST with form data", async () => {
      const projectDir = await createProject(
        "api-post-form",
        pages.basic,
        {
          files: {
            "pages/api/contact.ts": `
export async function POST(ctx) {
  const formData = await ctx.request.formData();
  const name = formData.get("name");
  const message = formData.get("message");
  return Response.json({ received: true, name, message });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/contact`;
        const formData = new FormData();
        formData.append("name", "Bob");
        formData.append("message", "Hello world");

        const response = await fetch(url, {
          method: "POST",
          body: formData,
        });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("received", true)
          .toHaveProperty("name", "Bob")
          .toHaveProperty("message", "Hello world");
      });
    });
  });

  describe("PUT Requests", () => {
    it("should handle PUT for updates", async () => {
      const projectDir = await createProject(
        "api-put",
        pages.basic,
        {
          files: {
            "pages/api/items/[id].ts": `
export async function PUT(ctx) {
  const body = await ctx.request.json();
  const id = ctx.params.id;
  return Response.json({
    updated: true,
    item: { id, ...body }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/items/item-456`;
        const response = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Item", price: 99.99 }),
        });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("updated", true);
        assert(json.item.id === "item-456", "Should have item id from params");
        assert(json.item.name === "Updated Item", "Should have updated name");
      });
    });
  });

  describe("DELETE Requests", () => {
    it("should handle DELETE requests", async () => {
      const projectDir = await createProject(
        "api-delete",
        pages.basic,
        {
          files: {
            "pages/api/items/[id].ts": `
export function DELETE(ctx) {
  const id = ctx.params.id;
  return Response.json({ deleted: true, id }, { status: 200 });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/items/item-789`;
        const response = await fetch(url, { method: "DELETE" });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("deleted", true)
          .toHaveProperty("id", "item-789");
      });
    });

    it("should return 204 No Content for DELETE", async () => {
      const projectDir = await createProject(
        "api-delete-204",
        pages.basic,
        {
          files: {
            "pages/api/sessions/[id].ts": `
export function DELETE(ctx) {
  // Session deleted, no content to return
  return new Response(null, { status: 204 });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/sessions/sess-123`;
        const response = await fetch(url, { method: "DELETE" });

        assertStatus(response, 204);
      });
    });
  });

  describe("PATCH Requests", () => {
    it("should handle PATCH for partial updates", async () => {
      const projectDir = await createProject(
        "api-patch",
        pages.basic,
        {
          files: {
            "pages/api/users/[id].ts": `
export async function PATCH(ctx) {
  const body = await ctx.request.json();
  const id = ctx.params.id;
  return Response.json({
    patched: true,
    id,
    updates: body
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/users/user-001`;
        const response = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("patched", true)
          .toHaveProperty("id", "user-001");
        assert(json.updates.status === "active", "Should have patch data");
      });
    });
  });

  describe("Multiple Methods in One File", () => {
    it("should support multiple HTTP methods", async () => {
      const projectDir = await createProject(
        "api-multi-method",
        pages.basic,
        {
          files: {
            "pages/api/resource.ts": `
export function GET() {
  return Response.json({ method: "GET", action: "list" });
}

export async function POST(ctx) {
  const body = await ctx.request.json();
  return Response.json({ method: "POST", action: "create", data: body }, { status: 201 });
}

export function DELETE() {
  return Response.json({ method: "DELETE", action: "delete" });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const baseUrl = `http://127.0.0.1:${server.port}/api/resource`;

        // Test GET
        const getRes = await fetch(baseUrl);
        const getJson = await getRes.json();
        assert(getJson.method === "GET", "GET should work");

        // Test POST
        const postRes = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true }),
        });
        const postJson = await postRes.json();
        assertStatus(postRes, 201);
        assert(postJson.method === "POST", "POST should work");

        // Test DELETE
        const deleteRes = await fetch(baseUrl, { method: "DELETE" });
        const deleteJson = await deleteRes.json();
        assert(deleteJson.method === "DELETE", "DELETE should work");
      });
    });
  });

  describe("Request Headers", () => {
    it("should access request headers", async () => {
      const projectDir = await createProject(
        "api-headers",
        pages.basic,
        {
          files: {
            "pages/api/echo-headers.ts": `
export function GET(ctx) {
  const authHeader = ctx.headers.get("authorization");
  const customHeader = ctx.headers.get("x-custom-header");
  return Response.json({
    authorization: authHeader,
    customHeader: customHeader
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/echo-headers`;
        const response = await fetch(url, {
          headers: {
            Authorization: "Bearer test-token",
            "X-Custom-Header": "custom-value",
          },
        });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("authorization", "Bearer test-token")
          .toHaveProperty("customHeader", "custom-value");
      });
    });
  });

  describe("Query Parameters", () => {
    it("should access query parameters in POST requests", async () => {
      const projectDir = await createProject(
        "api-query-post",
        pages.basic,
        {
          files: {
            "pages/api/search.ts": `
export async function POST(ctx) {
  const query = ctx.query.get("q");
  const page = ctx.query.get("page") || "1";
  const body = await ctx.request.json();
  return Response.json({ query, page, filters: body.filters });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/search?q=test&page=2`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters: { category: "books" } }),
        });
        const json = await response.json();

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("query", "test")
          .toHaveProperty("page", "2");
        assert(json.filters.category === "books", "Should have filter data");
      });
    });
  });
});
