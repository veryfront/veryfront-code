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

it("selects the canonical file move route and nothing next to it", () => {
  for (
    const path of [
      "/projects/p/files/a%2Fb.ts/move",
      "/projects/p/files/opaque-alias/move",
      "/projects/p/files/88888888-8888-4888-8888-888888888888/move",
      // A file that is itself named "move" still moves through the canonical route.
      "/projects/p/files/move/move",
    ]
  ) {
    assertEquals(isRuntimeFileMutationRequest("POST", path), true, path);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
      assertEquals(isRuntimeFileMutationRequest(method, path), false, `${method} ${path}`);
    }
  }
  for (
    const path of [
      "/projects/p/files/a/b.ts/move",
      "/projects/p/files//move",
      "/projects/p/files/a%2Fb.ts/move/",
      "/projects/p/files/a%2Fb.ts/move/extra",
      "/projects/p/files/a%2Fb.ts/copy",
      "/projects/p/files/a%2Fb.ts/moved",
      "/projects/p/files/a%2Fb.ts/move?branch_id=b",
      "/projects/p/files/a%2Fb.ts/move#fragment",
      "/projects/p/files/a%2Fb.ts?x=/move",
      "/projects/p/files/a%2Fb.ts#/move",
      "/projects/p/branches/b/files/a%2Fb.ts/move",
      "/projects/p/knowledge/assets/a%2Fb.bin/move",
      "/projects/p/q/files/a%2Fb.ts/move",
      "/projects//files/a%2Fb.ts/move",
      "/files/a%2Fb.ts/move",
      "/api/projects/p/files/a%2Fb.ts/move",
      "https://foreign.example/projects/p/files/a%2Fb.ts/move",
      "//foreign.example/projects/p/files/a%2Fb.ts/move",
      "/projects/p/files/a%2Fb.ts/move\n",
    ]
  ) {
    assertEquals(isRuntimeFileMutationRequest("POST", path), false, path);
  }
});

it("selects raw knowledge asset PUTs for canonical writer authority", () => {
  const path = "/projects/p/knowledge/assets/knowledge%2Fa.bin?branch_id=b";
  assertEquals(isRuntimeFileMutationRequest("PUT", path), true);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    assertEquals(isRuntimeFileMutationRequest(method, path), false);
  }
});
