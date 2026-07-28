import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { JSDOM } from "npm:jsdom@28.0.0";
import {
  applyRscPayload,
  retireAbandonedHeadOwnerMarkers,
  selectHydrationRoot,
  shouldAttemptRSCTransport,
  shouldHydrateOnly,
  shouldRenderPageComponent,
  shouldUsePageRendererHydration,
  shouldWrapPageHydrationRoot,
} from "./client-boot.ts";

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
  describe("applyRscPayload", () => {
    class PayloadElement {
      id = "";
      innerHTML = "";
      children: PayloadElement[] = [];

      appendChild(child: PayloadElement): PayloadElement {
        this.children.push(child);
        return child;
      }
    }

    class PayloadDocument {
      readonly body = new PayloadElement();

      createElement(): PayloadElement {
        return new PayloadElement();
      }

      getElementById(id: string): PayloadElement | null {
        return this.body.children.find((child) => child.id === id) ?? null;
      }
    }

    it("writes the fallback HTML payload into the canonical RSC root", () => {
      const doc = new PayloadDocument() as unknown as Document;

      assertEquals(applyRscPayload(doc, { html: "<main>Ready</main>" }), true);
      assertEquals(doc.getElementById("rsc-root")?.innerHTML, "<main>Ready</main>");
      assertEquals(doc.getElementById("rsc-slot-rsc-root"), null);
    });

    it("rejects malformed payload slots atomically", () => {
      const doc = new PayloadDocument() as unknown as Document;

      assertEquals(
        applyRscPayload(doc, {
          slots: {
            sidebar: "<aside>Safe</aside>",
            "../escape": "<div>Unsafe</div>",
          },
        }),
        false,
      );
      assertEquals(doc.getElementById("rsc-slot-sidebar"), null);
      assertEquals(doc.getElementById("rsc-slot-../escape"), null);
    });
  });

  describe("shouldRenderPageComponent", () => {
    it("client-renders proxy modules that cannot hydrate server-owned markup", () => {
      assertEquals(shouldRenderPageComponent("rsc-module"), true);
    });

    it("hydrates local filesystem modules against their server markup", () => {
      assertEquals(shouldRenderPageComponent("fs"), false);
    });
  });

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

  describe("shouldUsePageRendererHydration", () => {
    function makeDocument(ids: string[] = []) {
      const elements = new Set(ids);
      return {
        getElementById(id: string): Element | null {
          return elements.has(id) ? ({} as Element) : null;
        },
      };
    }

    it("lets the production page renderer own client-page hydration when present", () => {
      const shouldUseRenderer = shouldUsePageRendererHydration(
        { __veryfrontRenderPage: () => {} },
        { pagePath: "app/page.tsx", clientModuleStrategy: "rsc-module" },
        makeDocument(["root"]),
      );

      assertEquals(shouldUseRenderer, true);
    });

    it("keeps RSC boot ownership when the page renderer has no root container", () => {
      const shouldUseRenderer = shouldUsePageRendererHydration(
        { __veryfrontRenderPage: () => {} },
        { pagePath: "app/page.tsx", clientModuleStrategy: "rsc-module" },
        makeDocument(),
      );

      assertEquals(shouldUseRenderer, false);
    });

    it("keeps RSC boot ownership when the page renderer is absent", () => {
      const shouldUseRenderer = shouldUsePageRendererHydration(
        {},
        { pagePath: "app/page.tsx", clientModuleStrategy: "rsc-module" },
        makeDocument(["root"]),
      );

      assertEquals(shouldUseRenderer, false);
    });
  });

  describe("shouldHydrateOnly", () => {
    it("detects hydrate-only imports", () => {
      assertEquals(shouldHydrateOnly("/_veryfront/rsc/client.js?hydrate=1"), true);
    });

    it("uses normal boot mode by default", () => {
      assertEquals(shouldHydrateOnly("/_veryfront/rsc/client.js"), false);
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

    it("falls back to the parent container when the page owns the direct child root", () => {
      const headPlaceholder = toCandidate(createElement("DIV", {
        "data-veryfront-head": "1",
        style: "display:none",
      }));
      const main = toCandidate(createElement("MAIN"));
      const body = toCandidate(createElement("BODY"));

      const root = selectHydrationRoot([headPlaceholder, main], body);

      assertEquals(root, body);
    });

    it("uses the parent container when only non-render nodes and page roots are present", () => {
      const script = toCandidate(createElement("SCRIPT"));
      const section = toCandidate(createElement("SECTION"));
      const body = toCandidate(createElement("BODY"));

      const root = selectHydrationRoot([script, section], body);

      assertEquals(root, body);
    });
  });

  describe("shouldWrapPageHydrationRoot", () => {
    it("wraps the server markup when the fallback parent is the selected root", () => {
      const body = toCandidate(createElement("BODY"));

      assertEquals(shouldWrapPageHydrationRoot(body, body), true);
    });

    it("uses the explicit wrapper directly when one is selected", () => {
      const wrapper = toCandidate(createElement("DIV", { class: "page-shell" }));
      const body = toCandidate(createElement("BODY"));

      assertEquals(shouldWrapPageHydrationRoot(wrapper, body), false);
    });
  });

  describe("retireAbandonedHeadOwnerMarkers", () => {
    it("removes only owner markers outside the chosen hydration root", () => {
      const dom = new JSDOM(`
        <body>
          <div data-vf-react-head-owner="1" id="orphan"></div>
          <main id="root">
            <div data-vf-react-head-owner="1" id="owned"></div>
          </main>
        </body>
      `);
      try {
        const root = dom.window.document.getElementById("root");
        if (!root) throw new Error("missing fixture root");
        retireAbandonedHeadOwnerMarkers(
          [...dom.window.document.body.children],
          root,
        );

        assertEquals(dom.window.document.getElementById("orphan"), null);
        assertEquals(
          dom.window.document.getElementById("owned")?.isConnected,
          true,
        );
      } finally {
        dom.window.close();
      }
    });
  });
});
