import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { isRuntimeFileMutationRequest } from "./runtime-file-mutation-authority.ts";

it("selects exact REST file mutations including opaque aliases and UUIDs", () => {
  for (
    const path of [
      "/projects/p/files/knowledge%2Fcurrent.md",
      "/projects/p/files/opaque-alias",
      "/projects/p/files/88888888-8888-4888-8888-888888888888",
      "/projects/p/branches/b/files/current/draft",
    ]
  ) {
    for (const method of ["PUT", "DELETE"]) {
      assertEquals(isRuntimeFileMutationRequest(method, path), true);
    }
  }
  for (
    const path of [
      "/projects/p/files/move",
      "/projects/p/commit",
      "/projects/p/branches/b/files/current/index",
    ]
  ) {
    assertEquals(isRuntimeFileMutationRequest("POST", path), true);
  }
});
it("excludes read POST batches, lists, arbitrary endpoints and wrong methods", () => {
  for (const method of ["GET", "PATCH", "HEAD"]) {
    for (
      const path of [
        "/projects/p/files/current",
        "/projects/p/files/move",
        "/projects/p/commit",
        "/projects/p/branches/b/files/current/draft",
        "/projects/p/branches/b/files/current/index",
      ]
    ) {
      assertEquals(isRuntimeFileMutationRequest(method, path), false);
    }
  }
  for (
    const path of [
      "/projects/p/files/batch",
      "/projects/p/files/search",
      "/projects/p/files",
      "/runs",
      "https://foreign.example/projects/p/commit",
      "//foreign.example/projects/p/commit",
      "/projects/p/commit#fragment",
      "/projects/p/branches/b/files/current/chunks",
    ]
  ) {
    assertEquals(isRuntimeFileMutationRequest("POST", path), false);
  }
});
