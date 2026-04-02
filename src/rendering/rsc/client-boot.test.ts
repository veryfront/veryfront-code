import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { selectHydrationRoot } from "./client-boot.ts";

type MockElement = {
  tagName: string;
  attrs?: Record<string, string>;
};

function createElement(tagName: string, attrs: Record<string, string> = {}): MockElement {
  return { tagName, attrs };
}

function toCandidate(element: MockElement) {
  return {
    tagName: element.tagName,
    hasAttribute(name: string): boolean {
      return name in (element.attrs ?? {});
    },
    getAttribute(name: string): string | null {
      return element.attrs?.[name] ?? null;
    },
  };
}

describe("rendering/rsc/client-boot", () => {
  describe("selectHydrationRoot", () => {
    it("prefers a direct child div with a class", () => {
      const main = toCandidate(createElement("MAIN"));
      const wrapper = toCandidate(createElement("DIV", { class: "page-shell" }));
      const body = toCandidate(createElement("BODY"));

      const root = selectHydrationRoot([main, wrapper], body);

      assertEquals(root, wrapper);
    });

    it("falls back to the first non-placeholder child for non-div roots", () => {
      const headPlaceholder = toCandidate(createElement("DIV", {
        "data-veryfront-head": "1",
        style: "display:none",
      }));
      const main = toCandidate(createElement("MAIN"));
      const body = toCandidate(createElement("BODY"));

      const root = selectHydrationRoot([headPlaceholder, main], body);

      assertEquals(root, main);
    });

    it("skips non-render nodes before selecting a root", () => {
      const script = toCandidate(createElement("SCRIPT"));
      const section = toCandidate(createElement("SECTION"));
      const body = toCandidate(createElement("BODY"));

      const root = selectHydrationRoot([script, section], body);

      assertEquals(root, section);
    });
  });
});
