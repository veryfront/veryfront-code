/**
 * Path utilities tests
 */

import { assertEquals } from "@std/assert";
import { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.ts";

Deno.test("toOpenAPIPath", async (t) => {
  await t.step("should convert single dynamic segment", () => {
    assertEquals(toOpenAPIPath("/api/users/[id]"), "/api/users/{id}");
  });

  await t.step("should convert multiple dynamic segments", () => {
    assertEquals(
      toOpenAPIPath("/api/users/[userId]/posts/[postId]"),
      "/api/users/{userId}/posts/{postId}",
    );
  });

  await t.step("should convert catch-all segment", () => {
    assertEquals(toOpenAPIPath("/api/files/[...path]"), "/api/files/{path}");
  });

  await t.step("should convert optional catch-all segment", () => {
    assertEquals(toOpenAPIPath("/api/docs/[[...slug]]"), "/api/docs/{slug}");
  });

  await t.step("should handle static paths", () => {
    assertEquals(toOpenAPIPath("/api/health"), "/api/health");
  });

  await t.step("should handle mixed static and dynamic", () => {
    assertEquals(
      toOpenAPIPath("/api/v1/users/[id]/settings"),
      "/api/v1/users/{id}/settings",
    );
  });
});

Deno.test("extractPathParams", async (t) => {
  await t.step("should extract single required param", () => {
    const params = extractPathParams("/api/users/[id]");
    assertEquals(params, [{ name: "id", required: true, catchAll: false }]);
  });

  await t.step("should extract multiple params", () => {
    const params = extractPathParams("/api/users/[userId]/posts/[postId]");
    assertEquals(params, [
      { name: "userId", required: true, catchAll: false },
      { name: "postId", required: true, catchAll: false },
    ]);
  });

  await t.step("should mark catch-all as required", () => {
    const params = extractPathParams("/api/files/[...path]");
    assertEquals(params, [{ name: "path", required: true, catchAll: true }]);
  });

  await t.step("should mark optional catch-all as not required", () => {
    const params = extractPathParams("/api/docs/[[...slug]]");
    assertEquals(params, [{ name: "slug", required: false, catchAll: true }]);
  });

  await t.step("should return empty for static paths", () => {
    const params = extractPathParams("/api/health");
    assertEquals(params, []);
  });
});

Deno.test("generateOperationId", async (t) => {
  await t.step("should generate simple operation id", () => {
    // Note: /api prefix is stripped by design
    assertEquals(generateOperationId("GET", "/api/users"), "getUsers");
  });

  await t.step("should handle path parameters", () => {
    assertEquals(
      generateOperationId("GET", "/api/users/{id}"),
      "getUsersById",
    );
  });

  await t.step("should handle POST method", () => {
    assertEquals(generateOperationId("POST", "/api/users"), "postUsers");
  });

  await t.step("should handle complex paths", () => {
    assertEquals(
      generateOperationId("PUT", "/api/users/{userId}/posts/{postId}"),
      "putUsersByUserIdPostsByPostId",
    );
  });

  await t.step("should handle non-api paths", () => {
    assertEquals(generateOperationId("GET", "/health"), "getHealth");
  });
});
