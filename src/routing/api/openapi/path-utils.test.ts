/**
 * Path utilities tests
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.ts";

describe("toOpenAPIPath", () => {
  it("should convert single dynamic segment", () => {
    assertEquals(toOpenAPIPath("/api/users/[id]"), "/api/users/{id}");
  });

  it("should convert multiple dynamic segments", () => {
    assertEquals(
      toOpenAPIPath("/api/users/[userId]/posts/[postId]"),
      "/api/users/{userId}/posts/{postId}",
    );
  });

  it("should convert catch-all segment", () => {
    assertEquals(toOpenAPIPath("/api/files/[...path]"), "/api/files/{path}");
  });

  it("should convert optional catch-all segment", () => {
    assertEquals(toOpenAPIPath("/api/docs/[[...slug]]"), "/api/docs/{slug}");
  });

  it("should handle static paths", () => {
    assertEquals(toOpenAPIPath("/api/health"), "/api/health");
  });

  it("should handle mixed static and dynamic", () => {
    assertEquals(
      toOpenAPIPath("/api/v1/users/[id]/settings"),
      "/api/v1/users/{id}/settings",
    );
  });
});

describe("extractPathParams", () => {
  it("should extract single required param", () => {
    const params = extractPathParams("/api/users/[id]");
    assertEquals(params, [{ name: "id", required: true, catchAll: false }]);
  });

  it("should extract multiple params", () => {
    const params = extractPathParams("/api/users/[userId]/posts/[postId]");
    assertEquals(params, [
      { name: "userId", required: true, catchAll: false },
      { name: "postId", required: true, catchAll: false },
    ]);
  });

  it("should mark catch-all as required", () => {
    const params = extractPathParams("/api/files/[...path]");
    assertEquals(params, [{ name: "path", required: true, catchAll: true }]);
  });

  it("should mark optional catch-all as not required", () => {
    const params = extractPathParams("/api/docs/[[...slug]]");
    assertEquals(params, [{ name: "slug", required: false, catchAll: true }]);
  });

  it("should return empty for static paths", () => {
    const params = extractPathParams("/api/health");
    assertEquals(params, []);
  });
});

describe("generateOperationId", () => {
  it("should generate simple operation id", () => {
    // Note: /api prefix is stripped by design
    assertEquals(generateOperationId("GET", "/api/users"), "getUsers");
  });

  it("should handle path parameters", () => {
    assertEquals(
      generateOperationId("GET", "/api/users/{id}"),
      "getUsersById",
    );
  });

  it("should handle POST method", () => {
    assertEquals(generateOperationId("POST", "/api/users"), "postUsers");
  });

  it("should handle complex paths", () => {
    assertEquals(
      generateOperationId("PUT", "/api/users/{userId}/posts/{postId}"),
      "putUsersByUserIdPostsByPostId",
    );
  });

  it("should handle non-api paths", () => {
    assertEquals(generateOperationId("GET", "/health"), "getHealth");
  });
});
