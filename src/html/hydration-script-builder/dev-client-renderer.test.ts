import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";
import { generateProdHydrationModule } from "./prod-scripts.ts";
import { escapeInlineScriptContent } from "../html-escape.ts";

describe("hydration-script-builder/dev-client-renderer", () => {
  describe("generateDevClientRendererScript", () => {
    it("should return a module script tag", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes('<script type="module"'), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateDevClientRendererScript("my-nonce");
      assertEquals(result.includes('nonce="my-nonce"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes("nonce="), false);
    });

    it("should leave React and the react runtime as bare imports for the import map", () => {
      const result = generateDevClientRendererScript();
      assertEquals(result.includes('import * as React from "react"'), true);
      assertEquals(result.includes('from "react-dom/client"'), true);
      assertEquals(result.includes('from "veryfront/router"'), true);
      assertEquals(result.includes('from "veryfront/context"'), true);
    });

    it("should serve the same bundled runtime as production", () => {
      const result = generateDevClientRendererScript();
      assertEquals(
        result.includes(escapeInlineScriptContent(generateProdHydrationModule())),
        true,
      );
    });

    it("should emit exactly one closing script tag", () => {
      const result = generateDevClientRendererScript();
      assertEquals([...result.matchAll(/<\/script>/gi)].length, 1);
      assertEquals(result.trimEnd().endsWith("</script>"), true);
    });
  });

  // The inlined bytes come from whatever the runtime modules happen to contain.
  // Nothing stops a future module from putting `</script>` in a string literal,
  // and unescaped that would close the tag and spill the rest of the runtime
  // into the document as markup.
  describe("inline script escaping", () => {
    const moduleShaped = 'function render() { return "<div></script></div>"; }';

    it("escapes a </script> that a runtime module could legitimately contain", () => {
      const escaped = escapeInlineScriptContent(moduleShaped);

      assertEquals(/<\/script/i.test(escaped), false);
      assertEquals(escaped.includes("<\\/script"), true);
    });

    it("keeps the escaped runtime inside a single script tag", () => {
      const document = `<script type="module">\n${
        escapeInlineScriptContent(moduleShaped)
      }\n</script>`;

      assertEquals([...document.matchAll(/<\/script>/gi)].length, 1);
    });

    it("leaves the escaped JavaScript meaning exactly what it did", () => {
      // `</script` can only appear in a string, comment or regex, where `<\/script`
      // is the same value — which is why escaping is safe rather than lossy.
      const escaped = escapeInlineScriptContent(moduleShaped);
      const rendered = new Function(escaped + "; return render();")() as string;

      assertEquals(rendered, "<div></script></div>");
    });
  });
});
