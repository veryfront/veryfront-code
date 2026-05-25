import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { isBlobRef } from "./guards.ts";

describe("workflow/blob/guards", () => {
  describe("isBlobRef", () => {
    it("accepts a well-formed blob ref", () => {
      const ref = {
        __kind: "blob",
        id: "b1",
        size: 42,
        mimeType: "text/plain",
        createdAt: new Date(),
      };
      expect(isBlobRef(ref)).toBe(true);
    });

    it("rejects objects missing required fields", () => {
      expect(isBlobRef({ __kind: "blob" })).toBe(false);
      expect(isBlobRef({ __kind: "blob", id: "b1" })).toBe(false);
      expect(isBlobRef({ id: "b1", size: 1, mimeType: "x", createdAt: new Date() })).toBe(false);
    });

    it("rejects objects whose __kind is not 'blob'", () => {
      expect(isBlobRef({ __kind: "other", id: "x", size: 1, mimeType: "y", createdAt: new Date() }))
        .toBe(false);
    });

    it("rejects primitives, null, undefined, arrays, functions", () => {
      for (const v of [null, undefined, "blob", 1, true, [], () => {}]) {
        expect(isBlobRef(v)).toBe(false);
      }
    });
  });
});
