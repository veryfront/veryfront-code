import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assert, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";

describe("blob ids", () => {
  it("accepts only the framework portable identifier alphabet", () => {
    for (const id of ["a", "ABC_123", "blob-id", crypto.randomUUID()]) {
      assert(isSafeBlobId(id));
      assertSafeBlobId(id);
    }

    for (
      const id of [undefined, null, 1, "", "a/b", "a b", "a?b", "\ud800", "a".repeat(257)]
    ) {
      assert(!isSafeBlobId(id));
      assertThrows(
        () => assertSafeBlobId(id),
        VeryfrontError,
        "Blob IDs must contain at most 256 alphanumeric characters, hyphens, and underscores",
      );
    }
  });
});
