import { assert, assertFalse, assertThrows } from "@std/assert";
import { assertSafeBlobId, isSafeBlobId, MAX_BLOB_ID_CODE_UNITS } from "./blob-id.ts";

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

  assert(isSafeBlobId("a".repeat(MAX_BLOB_ID_CODE_UNITS)));
  assertFalse(isSafeBlobId("a".repeat(MAX_BLOB_ID_CODE_UNITS + 1)));
  assertThrows(
    () => assertSafeBlobId("a".repeat(MAX_BLOB_ID_CODE_UNITS + 1)),
    Error,
    `at most ${MAX_BLOB_ID_CODE_UNITS}`,
  );
});
