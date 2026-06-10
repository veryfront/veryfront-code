import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildUploadResourceUrl } from "./use-uploads.ts";

describe("buildUploadResourceUrl", () => {
  it("encodes upload IDs before appending them to the API path", () => {
    assertEquals(
      buildUploadResourceUrl("/api/uploads", "folder/a b.json?x=1"),
      "/api/uploads/folder%2Fa%20b.json%3Fx%3D1",
    );
  });
});
