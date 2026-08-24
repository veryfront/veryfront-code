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
      expect(isBlobRef({ ...ref, mimeType: "" })).toBe(true);
    });

    it("rejects objects missing required fields", () => {
      expect(isBlobRef({ __kind: "blob" })).toBe(false);
      expect(isBlobRef({ __kind: "blob", id: "b1" })).toBe(false);
      expect(isBlobRef({ id: "b1", size: 1, mimeType: "x", createdAt: new Date() })).toBe(false);
    });

    it("rejects objects whose fields have the wrong types", () => {
      expect(
        isBlobRef({
          __kind: "blob",
          id: "b1",
          size: 1,
          mimeType: "x",
          createdAt: "2024-01-01T00:00:00Z",
        }),
      ).toBe(false);
      expect(
        isBlobRef({ __kind: "blob", id: "b1", size: "1", mimeType: "x", createdAt: new Date() }),
      )
        .toBe(false);
      expect(isBlobRef({ __kind: "blob", id: "b1", size: 1, mimeType: 1, createdAt: new Date() }))
        .toBe(false);
      expect(isBlobRef({ __kind: "blob", id: 1, size: 1, mimeType: "x", createdAt: new Date() }))
        .toBe(false);
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

    it("rejects unsafe identities, sizes, and dates", () => {
      const valid = {
        __kind: "blob",
        id: "blob-id",
        size: 1,
        mimeType: "text/plain",
        createdAt: new Date(),
      };

      for (
        const ref of [
          { ...valid, id: "../blob" },
          { ...valid, size: -1 },
          { ...valid, size: 1.5 },
          { ...valid, size: Number.NaN },
          { ...valid, createdAt: new Date(Number.NaN) },
        ]
      ) {
        expect(isBlobRef(ref)).toBe(false);
      }
    });

    it("does not invoke accessors while checking a reference", () => {
      let getterCalls = 0;
      const ref = Object.defineProperty(
        {
          __kind: "blob",
          size: 1,
          mimeType: "text/plain",
          createdAt: new Date(),
        },
        "id",
        {
          enumerable: true,
          get() {
            getterCalls++;
            return "blob-id";
          },
        },
      );

      expect(isBlobRef(ref)).toBe(false);
      expect(getterCalls).toBe(0);
    });

    it("rejects malformed optional fields", () => {
      const valid = {
        __kind: "blob",
        id: "blob-id",
        size: 1,
        mimeType: "text/plain",
        createdAt: new Date(),
      };

      for (
        const ref of [
          { ...valid, expiresAt: "tomorrow" },
          { ...valid, url: 1 },
          { ...valid, metadata: [] },
          { ...valid, metadata: { source: 1 } },
        ]
      ) {
        expect(isBlobRef(ref)).toBe(false);
      }
    });
  });
});
