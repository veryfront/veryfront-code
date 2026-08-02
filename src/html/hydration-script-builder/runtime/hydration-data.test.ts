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
  const hydrationElement = {
    id: HYDRATION_DATA_ELEMENT_ID,
    tagName: "SCRIPT",
    textContent,
    getAttribute: (name: string) => name === "type" ? "application/json" : null,
  };
  return {
    body: { firstElementChild: hydrationElement },
    querySelectorAll: () => [hydrationElement],
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
      const document = {
        body: { firstElementChild: null },
        querySelectorAll: () => [],
      } as unknown as RuntimeDocument;
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
      assertEquals(
        readDocumentDependencyPinningCacheKey(
          { dependencyPinningCacheKey: 1 } as unknown as PageDataPayload,
        ),
        null,
      );
    });
  });
});
