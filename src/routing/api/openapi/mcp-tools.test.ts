import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPISpec } from "./types.ts";

function makeSpec(paths: OpenAPISpec["paths"]): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths,
  };
}

describe("routing/api/openapi/mcp-tools", () => {
  describe("generateMCPToolsFromSpec()", () => {
    it("should generate tools for each operation", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            summary: "List users",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createUser",
            summary: "Create user",
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      assertEquals(tools.length, 2);
    });

    it("should use default tool prefix 'api'", () => {
      const spec = makeSpec({
        "/api/items": {
          get: {
            operationId: "getItems",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.id, "api:getItems");
    });

    it("should use custom tool prefix", () => {
      const spec = makeSpec({
        "/api/items": {
          get: {
            operationId: "getItems",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
        toolPrefix: "myapp",
      });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.id, "myapp:getItems");
    });

    it("should return empty array for empty paths", () => {
      const spec = makeSpec({});
      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });
      assertEquals(tools.length, 0);
    });

    it("should skip non-HTTP method entries", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      assertEquals(tools.length, 1);
    });

    it("should handle all HTTP methods", () => {
      const spec = makeSpec({
        "/api/resource": {
          get: {
            operationId: "getResource",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createResource",
            responses: { "201": { description: "Created" } },
          },
          put: {
            operationId: "updateResource",
            responses: { "200": { description: "OK" } },
          },
          patch: {
            operationId: "patchResource",
            responses: { "200": { description: "OK" } },
          },
          delete: {
            operationId: "deleteResource",
            responses: { "204": { description: "Deleted" } },
          },
          head: {
            operationId: "headResource",
            responses: { "200": { description: "OK" } },
          },
          options: {
            operationId: "optionsResource",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      assertEquals(tools.length, 7);
    });

    it("should include description with summary", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            summary: "List all users",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.description.includes("List all users"), true);
    });

    it("should handle operations with tags in description", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            summary: "List users",
            tags: ["users", "admin"],
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.description.includes("Tags: users, admin"), true);
    });

    it("should handle deprecated operations", () => {
      const spec = makeSpec({
        "/api/old": {
          get: {
            operationId: "getOld",
            summary: "Old endpoint",
            deprecated: true,
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.description.includes("DEPRECATED"), true);
    });

    it("should skip null path items", () => {
      const spec = makeSpec({
        "/api/users": null as unknown as OpenAPISpec["paths"][string],
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      assertEquals(tools.length, 0);
    });

    it("should generate tools for multiple paths", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: { "200": { description: "OK" } },
          },
        },
        "/api/posts": {
          get: {
            operationId: "getPosts",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createPost",
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: "http://localhost:3000",
      });

      assertEquals(tools.length, 3);
      const ids = tools.map((t) => t.id);
      assertEquals(ids.includes("api:getUsers"), true);
      assertEquals(ids.includes("api:getPosts"), true);
      assertEquals(ids.includes("api:createPost"), true);
    });
  });
});
