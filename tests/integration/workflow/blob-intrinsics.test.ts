import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isSafeBlobId } from "#veryfront/workflow/blob/blob-id.ts";
import { isBlobRef } from "#veryfront/workflow/blob/guards.ts";

describe("workflow blob guards with hostile ambient intrinsics", () => {
  it("does not trust a replaced RegExp.prototype.test for blob IDs", () => {
    const originalTest = RegExp.prototype.test;
    const originalExec = RegExp.prototype.exec;
    try {
      RegExp.prototype.test = () => true;
      RegExp.prototype.exec = (() => ({ 0: "../unsafe", index: 0 })) as never;
      assertEquals(isSafeBlobId("../unsafe"), false);
      assertEquals(
        isBlobRef({
          __kind: "blob",
          id: "../unsafe",
          size: 1,
          mimeType: "text/plain",
          createdAt: new Date(),
        }),
        false,
      );
    } finally {
      RegExp.prototype.test = originalTest;
      RegExp.prototype.exec = originalExec;
    }
  });
});
