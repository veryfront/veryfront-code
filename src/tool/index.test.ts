import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions, ToolAnnotations } from "./index.ts";

describe("tool public type surface", () => {
  it("exports types referenced by public tool contracts", () => {
    const acceptsPublicTypes = (
      _annotations: ToolAnnotations | undefined,
      _blobStorage: BlobStorage | undefined,
      _blobRef: BlobRef | undefined,
      _storeOptions: StoreBlobOptions | undefined,
    ): boolean => true;

    assertEquals(acceptsPublicTypes(undefined, undefined, undefined, undefined), true);
  });
});
