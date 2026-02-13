#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: API Routes
 *
 * Tests that API routes work correctly:
 * - GET handlers returning JSON
 * - POST handlers receiving body
 * - Custom status codes
 * - Nested API routes
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertJsonContentType,
  assertStatus,
  createApiProject,
  createProject,
  ensureBinaryCompiled,
  expectApi,
  fetchJson,
  pages,
  withServer,
} from "../setup/index.ts";
import { assert } from "#veryfront/testing/assert.ts";

describe("Feature: API Routes", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("GET Handlers", () => {
    it("should handle GET requests returning JSON", async () => {
      const projectDir = await createApiProject("api-get");

      await withServer(projectDir, async (server) => {
        const { response, json } = await fetchJson<{ message: string; timestamp: number }>(
          server,
          "/api/hello",
        );

        expectApi(response, json)
          .toBeOk()
          .toBeJson()
          .toHaveProperty("message", "Hello")
          .toHaveProperty("timestamp");

        assert(json.timestamp > 0, "Timestamp should be positive");
      });
    });

    it("should handle nested API routes", async () => {
      const projectDir = await createProject(
        "api-nested",
        pages.basic,
        {
          files: {
            "pages/api/users/list.ts": `
export function GET() {
  return Response.json({ users: ["alice", "bob"], count: 2 });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, json } = await fetchJson<{ users: string[]; count: number }>(
          server,
          "/api/users/list",
        );

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("count", 2)
          .toHaveProperty("users");

        assert(json.users.length === 2, "Should have 2 users");
      });
    });
  });

  describe("Custom Status Codes", () => {
    it("should return custom status codes", async () => {
      const projectDir = await createProject(
        "api-status",
        pages.basic,
        {
          files: {
            "pages/api/created.ts": `
export function GET() {
  return new Response(JSON.stringify({ status: "created" }), {
    status: 201,
    headers: { "Content-Type": "application/json" }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, json } = await fetchJson<{ status: string }>(
          server,
          "/api/created",
        );

        assertStatus(response, 201);
        assertJsonContentType(response);
        expectApi(response, json).toHaveProperty("status", "created");
      });
    });
  });

  describe("Dynamic API Routes", () => {
    it("should handle dynamic [id] in Pages Router API routes", async () => {
      // Pages Router uses a single ctx argument with ctx.params
      const projectDir = await createProject(
        "api-dynamic-pages",
        pages.basic,
        {
          files: {
            "pages/api/items/[id].ts": `
export function GET(ctx) {
  return Response.json({ id: ctx.params.id, found: true });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, json } = await fetchJson<{ id: string; found: boolean }>(
          server,
          "/api/items/item-123",
        );

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("id", "item-123")
          .toHaveProperty("found", true);
      });
    });

    it("should handle dynamic [id] in App Router API routes", async () => {
      // App Router uses (request, { params }) signature
      const projectDir = await createProject(
        "api-dynamic-app",
        pages.basic,
        {
          files: {
            "app/api/items/[id]/route.ts": `
export function GET(request, { params }) {
  return Response.json({ id: params.id, found: true });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, json } = await fetchJson<{ id: string; found: boolean }>(
          server,
          "/api/items/item-123",
        );

        expectApi(response, json)
          .toBeOk()
          .toHaveProperty("id", "item-123")
          .toHaveProperty("found", true);
      });
    });
  });
});
