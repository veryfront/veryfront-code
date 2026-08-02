import { assert, assertFalse, assertThrows } from "@std/assert";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";

Deno.test("blob ids accept only the framework's portable identifier alphabet", () => {
  for (const id of ["a", "ABC_123", "blob-id", crypto.randomUUID()]) {
    assert(isSafeBlobId(id));
    assertSafeBlobId(id);
  }

  for (const id of [undefined, null, 1, "", "a/b", "a b", "a?b", "\ud800"]) {
    assertFalse(isSafeBlobId(id));
    assertThrows(
      () => assertSafeBlobId(id),
      Error,
      "Blob IDs must contain only alphanumeric characters, hyphens, and underscores",
    );
  }
});
