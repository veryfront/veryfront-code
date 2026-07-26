import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { filenameToId, filePathToId, filePathToPattern } from "./discovery-utils.ts";

Deno.test("filenameToId handles POSIX and Windows discovery paths", () => {
  assertEquals(filenameToId("file:///project/prompts/welcome-message.ts"), "welcomeMessage");
  assertEquals(filenameToId("C:\\project\\prompts\\welcome-message.ts"), "welcomeMessage");
});

Deno.test("filePathToId retains nested prompt paths and collapses directory indexes", () => {
  assertEquals(
    filePathToId(
      "file:///project/prompts/admin-tools/review-message.ts",
      "/project/prompts",
    ),
    "adminTools/reviewMessage",
  );
  assertEquals(
    filePathToId("/project/prompts/admin/index.ts", "/project/prompts"),
    "admin",
  );
  assertEquals(
    filePathToId("/project/prompts/index.ts", "/project/prompts"),
    "index",
  );
});

Deno.test("filePathToId rejects files outside the discovery root", () => {
  assertThrows(
    () => filePathToId("/other/review.ts", "/project/prompts"),
    Error,
    "outside discovery directory",
  );
});

Deno.test("filePathToPattern normalizes POSIX and Windows resource paths", () => {
  assertEquals(
    filePathToPattern(
      "file:///project/resources/users/[userId]/profile.ts",
      "/project/resources",
    ),
    "/users/:userId/profile",
  );
  assertEquals(
    filePathToPattern(
      "file:///C:/repo/resources/users/[userId]/profile.ts",
      "C:\\repo\\resources",
    ),
    "/users/:userId/profile",
  );
});

Deno.test("filePathToPattern decodes file URLs without leaking machine paths", () => {
  assertEquals(
    filePathToPattern(
      "file:///project/resources/release%20notes.ts",
      "/project/resources",
    ),
    "/release%20notes",
  );
});

Deno.test("filePathToPattern preserves literal percent signs in raw paths", () => {
  assertEquals(
    filePathToPattern(
      "/project/resources/%2E%2E/release%20notes.ts",
      "/project/resources",
    ),
    "/%252E%252E/release%2520notes",
  );
});

Deno.test("filePathToPattern rejects files outside the discovery root", () => {
  assertThrows(
    () => filePathToPattern("/other/users.ts", "/project/resources"),
    Error,
    "outside resource directory",
  );
});

Deno.test("filePathToPattern rejects encoded traversal and NUL segments", () => {
  assertThrows(
    () =>
      filePathToPattern(
        "file:///project/resources/%2E%2E/secrets.ts",
        "/project/resources",
      ),
    Error,
    "outside resource directory",
  );
  assertThrows(
    () =>
      filePathToPattern(
        "file:///project/resources/users/%00/profile.ts",
        "/project/resources",
      ),
    Error,
    "unsafe path segment",
  );
});
