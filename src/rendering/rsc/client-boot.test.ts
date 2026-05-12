import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { selectHydrationRoot, shouldAttemptRSCTransport } from "./client-boot.ts";

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
  describe("shouldAttemptRSCTransport", () => {
    function makeDocument(ids: string[] = []) {
      const elements = new Set(ids);
      return {
        getElementById(id: string): Element | null {
          return elements.has(id) ? ({} as Element) : null;
        },
      };
    }

    it("skips RSC transport fallback for client pages with hydration data", () => {
      const shouldAttempt = shouldAttemptRSCTransport(
        makeDocument(["rsc-root"]),
        { pagePath: "app/page.tsx", clientModuleStrategy: "rsc-module" },
      );

      assertEquals(shouldAttempt, false);
    });

    it("skips RSC transport fallback for plain documents without an RSC root", () => {
      const shouldAttempt = shouldAttemptRSCTransport(makeDocument(), null);

      assertEquals(shouldAttempt, false);
    });

    it("allows RSC transport fallback when the page includes an RSC root", () => {
      const shouldAttempt = shouldAttemptRSCTransport(makeDocument(["rsc-root"]), null);

      assertEquals(shouldAttempt, true);
    });
  });

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
