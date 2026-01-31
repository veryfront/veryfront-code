import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.ts";

describe("toOpenAPIPath", () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: "/api/users/[id]", expected: "/api/users/{id}" },
    {
      input: "/api/users/[userId]/posts/[postId]",
      expected: "/api/users/{userId}/posts/{postId}",
    },
    { input: "/api/files/[...path]", expected: "/api/files/{path}" },
    { input: "/api/docs/[[...slug]]", expected: "/api/docs/{slug}" },
    { input: "/api/health", expected: "/api/health" },
    {
      input: "/api/v1/users/[id]/settings",
      expected: "/api/v1/users/{id}/settings",
    },
  ];

  for (const { input, expected } of cases) {
    it(`should convert ${input}`, () => {
      assertEquals(toOpenAPIPath(input), expected);
    });
  }
});

describe("extractPathParams", () => {
  const cases: Array<{
    input: string;
    expected: Array<{ name: string; required: boolean; catchAll: boolean }>;
  }> = [
    {
      input: "/api/users/[id]",
      expected: [{ name: "id", required: true, catchAll: false }],
    },
    {
      input: "/api/users/[userId]/posts/[postId]",
      expected: [
        { name: "userId", required: true, catchAll: false },
        { name: "postId", required: true, catchAll: false },
      ],
    },
    {
      input: "/api/files/[...path]",
      expected: [{ name: "path", required: true, catchAll: true }],
    },
    {
      input: "/api/docs/[[...slug]]",
      expected: [{ name: "slug", required: false, catchAll: true }],
    },
    { input: "/api/health", expected: [] },
  ];

  for (const { input, expected } of cases) {
    it(`should extract params from ${input}`, () => {
      assertEquals(extractPathParams(input), expected);
    });
  }
});

describe("generateOperationId", () => {
  const cases: Array<{ method: string; path: string; expected: string }> = [
    // Note: /api prefix is stripped by design
    { method: "GET", path: "/api/users", expected: "getUsers" },
    { method: "GET", path: "/api/users/{id}", expected: "getUsersById" },
    { method: "POST", path: "/api/users", expected: "postUsers" },
    {
      method: "PUT",
      path: "/api/users/{userId}/posts/{postId}",
      expected: "putUsersByUserIdPostsByPostId",
    },
    { method: "GET", path: "/health", expected: "getHealth" },
  ];

  for (const { method, path, expected } of cases) {
    it(`should generate operation id for ${method} ${path}`, () => {
      assertEquals(generateOperationId(method, path), expected);
    });
  }
});
