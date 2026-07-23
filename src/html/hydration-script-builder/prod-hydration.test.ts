import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateProdHydrationScript } from "./prod-hydration.ts";

describe("hydration-script-builder/prod-hydration", () => {
  describe("generateProdHydrationScript", () => {
    it("should return a module script tag", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes('<script type="module"'), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateProdHydrationScript(
        "index",
        undefined,
        undefined,
        "n1",
      );
      assertEquals(result.includes('nonce="n1"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("nonce="), false);
    });

    it("should import React", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("import * as React from 'react'"), true);
    });

    it("should import ReactDOM from react-dom/client", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(
        result.includes("import * as ReactDOM from 'react-dom/client'"),
        true,
      );
    });

    it("should include the page slug in the import path", () => {
      const result = generateProdHydrationScript("about");
      assertEquals(result.includes("@/pages/about"), true);
    });

    it("should include different slug in import path", () => {
      const result = generateProdHydrationScript("blog/post");
      assertEquals(result.includes("@/pages/blog/post"), true);
    });

    it("should use hydrateRoot for hydration", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("hydrateRoot"), true);
    });

    it("should use identifierPrefix 'vf'", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("identifierPrefix: 'vf'"), true);
    });

    it("should include onRecoverableError handler", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("onRecoverableError"), true);
      assertEquals(result.includes("onRecoverableError: () => {}"), false);
      assertEquals(result.includes("Hydration recovery failed ("), true);
    });

    it("does not emit a top-level return in the generated module", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("if (!root) return"), false);
      assertEquals(result.includes("if (root) {"), true);
    });

    it("should serialize empty props by default", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("{}"), true);
    });

    it("should serialize provided props", () => {
      const props = { title: "Hello", count: 42 };
      const result = generateProdHydrationScript("index", undefined, props);
      assertEquals(result.includes('"title":"Hello"'), true);
      assertEquals(result.includes('"count":42'), true);
    });

    it("rejects non-object page props at the runtime boundary", () => {
      assertThrows(
        () => generateProdHydrationScript("index", undefined, [] as never),
        TypeError,
        "props",
      );
    });

    it("does not execute page-prop accessors or custom serializers", () => {
      let accessorCalls = 0;
      const props: Record<string, unknown> = {};
      Object.defineProperty(props, "value", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "private";
        },
      });
      assertThrows(
        () => generateProdHydrationScript("index", undefined, props),
        TypeError,
        "accessor properties",
      );
      assertEquals(accessorCalls, 0);

      let serializerCalls = 0;
      assertThrows(
        () =>
          generateProdHydrationScript("index", undefined, {
            value: {
              toJSON() {
                serializerCalls++;
                return "private";
              },
            },
          }),
        TypeError,
        "JSON-serializable",
      );
      assertEquals(serializerCalls, 0);
    });

    it("rejects cyclic and oversized nested page props", () => {
      const props: Record<string, unknown> = {};
      props.self = props;
      assertThrows(
        () => generateProdHydrationScript("index", undefined, props),
        TypeError,
        "cycles",
      );
      assertThrows(
        () =>
          generateProdHydrationScript("index", undefined, {
            values: Array.from({ length: 10_001 }, () => true),
          }),
        TypeError,
        "entry limit",
      );
    });

    it("rejects unsafe page module slugs", () => {
      for (
        const slug of [
          "../private",
          "blog/%2e%2e/private",
          "x';globalThis.__veryfrontSlugInjection = true;//\nnext",
        ]
      ) {
        assertThrows(
          () => generateProdHydrationScript(slug),
          TypeError,
          "page slug",
        );
      }
    });

    it("rejects traversal hidden behind many percent-encoding layers", () => {
      let traversal = "%2e%2e";
      for (let layer = 0; layer < 12; layer++) {
        traversal = traversal.replaceAll("%", "%25");
      }

      assertThrows(
        () => generateProdHydrationScript(`blog/${traversal}/private`),
        TypeError,
        "page slug",
      );
    });

    it("rejects encoded URL delimiters and malformed UTF-16 in page slugs", () => {
      for (
        const slug of [
          "blog/%253fquery",
          "blog/%2523fragment",
          "blog/%25e2%2580%25ae",
          "blog/invalid-\ud800",
        ]
      ) {
        assertThrows(
          () => generateProdHydrationScript(slug),
          TypeError,
          "page slug",
        );
      }
    });

    it("encodes props as a safe inline JavaScript literal", () => {
      const result = generateProdHydrationScript(
        "safe-page",
        undefined,
        {
          marker: "</script><script>globalThis.__veryfrontPropsBreakout = true</script>",
        },
      );

      assertEquals(result.includes("</script><script>"), false);
      assertEquals(result.includes("\\u003c/script"), true);
    });

    it("should import App and Layout components", () => {
      const result = generateProdHydrationScript("index");
      assertEquals(result.includes("import { App } from '@/components/app'"), true);
      assertEquals(
        result.includes("import { Layout } from '@/components/layout'"),
        true,
      );
    });

    it("should nest Page inside Layout inside App", () => {
      const result = generateProdHydrationScript("index");
      // Components are on separate lines in the multiline createElement calls
      assertEquals(result.includes("App,"), true);
      assertEquals(result.includes("Layout,"), true);
      assertEquals(result.includes("React.createElement(Page,"), true);
    });
  });
});
