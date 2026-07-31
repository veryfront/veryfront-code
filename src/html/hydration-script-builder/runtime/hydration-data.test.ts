import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PageDataPayload, RuntimeDocument } from "./env.ts";
import {
  HYDRATION_DATA_ELEMENT_ID,
  readDocumentDependencyPinningCacheKey,
  readInitialHydrationData,
} from "./hydration-data.ts";

function stubDocument(textContent: string | null): RuntimeDocument {
  return {
    getElementById: (id: string) => id === HYDRATION_DATA_ELEMENT_ID ? { textContent } : null,
  } as unknown as RuntimeDocument;
}

describe("hydration-script-builder/runtime/hydration-data", () => {
  describe("readInitialHydrationData", () => {
    it("parses the hydration data element", () => {
      assertEquals(
        readInitialHydrationData(stubDocument('{"pagePath":"page","params":{"id":"42"}}')),
        { pagePath: "page", params: { id: "42" } },
      );
    });

    it("returns an empty payload when the element is absent", () => {
      const document = { getElementById: () => null } as unknown as RuntimeDocument;
      assertEquals(readInitialHydrationData(document), {});
    });

    it("returns an empty payload when the element is empty", () => {
      assertEquals(readInitialHydrationData(stubDocument("")), {});
      assertEquals(readInitialHydrationData(stubDocument(null)), {});
    });

    it("returns an empty payload when the JSON is malformed", () => {
      assertEquals(readInitialHydrationData(stubDocument("{ not json")), {});
    });
  });

  describe("readDocumentDependencyPinningCacheKey", () => {
    it("returns the key when the document is pinned", () => {
      assertEquals(
        readDocumentDependencyPinningCacheKey({ dependencyPinningCacheKey: "on:snapshot-a" }),
        "on:snapshot-a",
      );
    });

    it("returns null when pinning is off or missing", () => {
      assertEquals(readDocumentDependencyPinningCacheKey({}), null);
      assertEquals(
        readDocumentDependencyPinningCacheKey({ dependencyPinningCacheKey: "off" }),
        null,
      );
    });

    it("returns an invalid sentinel for malformed snapshot keys", () => {
      for (const dependencyPinningCacheKey of [1, "on:", "on:bad/key", "unexpected"]) {
        assertEquals(
          readDocumentDependencyPinningCacheKey({
            dependencyPinningCacheKey,
          } as unknown as PageDataPayload),
          undefined,
        );
      }
    });
  });
});
