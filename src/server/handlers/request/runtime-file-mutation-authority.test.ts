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
      // The route takes its branch selector as a query, like the file routes.
      "/projects/p/files/a%2Fb.ts/move?branch_id=b",
      "/projects/p/files/a%2Fb.ts/move?branch=preview&x=/y",
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
      "/projects/p/files/a%2Fb.ts/move?branch_id=b#fragment",
      "/projects/p/files/a%2Fb.ts/move#fragment",
      "/projects/p/files/../move",
      "/projects/p/files/%2e%2e/move",
      "/projects/p/files/%2E%2e/move",
      "/projects/p/files/.%2E/move",
      "/projects/p/files/./move",
      "/projects/p/files/%2e/move",
      "/projects/../files/x/move",
      "/projects/%2E%2E/files/x/move",
      "/projects/p?x=1/files/a/move",
      "/projects/p/files/a\\b/move",
      "/projects/p/files/a\tb/move",
      "/projects/p/files/a\nb/move",
      "/projects/p/files/a\rb/move",
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

it("matches every route on the path the request is sent to", () => {
  const cases: Array<[string, string]> = [
    ["PUT", "/projects/p/files/.."],
    ["DELETE", "/projects/p/files/.."],
    ["DELETE", "/projects/p/files/%2E%2e"],
    ["DELETE", "/projects/p/files/."],
    ["PUT", "/projects/../files/a"],
    ["PUT", "/projects/p?x=1/files/a"],
    ["DELETE", "/projects/p/files/a\\b"],
    ["DELETE", "/projects/p/files/a\nb"],
    ["DELETE", "/projects/p/files/..\0"],
    ["DELETE", "/projects/p/files/.. "],
    ["PUT", "/projects/p/files/a b"],
    ["PUT", "/projects/p/branches/b/files/../draft"],
    ["PUT", "/projects/p/branches/b?x=1/files/a/draft"],
    ["PUT", "/projects/p/branches/b/files/a?x=1/draft"],
    ["PUT", "/projects/p/knowledge/assets/.."],
    ["PUT", "/projects/%2e%2e/knowledge/assets/a.bin"],
    ["POST", "/projects/../files/move"],
    ["POST", "/projects/../commit"],
    ["POST", "/projects/%2E%2E/commit"],
    ["POST", "/projects/p?x=1/commit"],
    ["POST", "/projects/p/branches/b/files/../index"],
    ["POST", "/projects/p/branches/../files/a/index"],
  ];
  for (const [method, path] of cases) {
    assertEquals(isRuntimeFileMutationRequest(method, path), false, `${method} ${path}`);
  }
  // Dots inside a name are ordinary characters.
  for (
    const path of ["/projects/p/files/.env", "/projects/p/files/a..b", "/projects/p/files/..."]
  ) {
    assertEquals(isRuntimeFileMutationRequest("PUT", path), true, path);
  }
  assertEquals(isRuntimeFileMutationRequest("POST", "/projects/p.q/commit"), true);
});

it("selects raw knowledge asset PUTs for canonical writer authority", () => {
  const path = "/projects/p/knowledge/assets/knowledge%2Fa.bin?branch_id=b";
  assertEquals(isRuntimeFileMutationRequest("PUT", path), true);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    assertEquals(isRuntimeFileMutationRequest(method, path), false);
  }
});
