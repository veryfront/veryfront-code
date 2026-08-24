import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { injectElementSelectors, isStudioEmbed } from "./element-selector-injector.ts";

describe("studio/element-selector-injector", () => {
  describe("injectElementSelectors", () => {
    it("should inject data-vf-selector into elements", () => {
      const html = `<div id="root"><p>Hello</p></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-div-1"'), true);
      assertEquals(result.includes('data-vf-selector="vf-p-2"'), true);
    });

    it("should skip script elements", () => {
      const html = `<div id="root"><script>alert(1)</script></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-script'), false);
    });

    it("should skip style elements", () => {
      const html = `<div id="root"><style>body{}</style></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-style'), false);
    });

    it("should use custom prefix", () => {
      const html = `<div id="root"><span>Hi</span></div>`;
      const result = injectElementSelectors(html, { prefix: "test" });

      assertEquals(result.includes('data-vf-selector="test-'), true);
    });

    it("should skip elements with data-vf-ignore", () => {
      const html = `<div id="root"><div data-vf-ignore>skip</div></div>`;
      const result = injectElementSelectors(html);

      assertEquals((result.match(/data-vf-selector/g) ?? []).length, 1);
    });

    it("should handle void elements", () => {
      const html = `<div id="root"><img src="test.png"><br></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-img-'), true);
    });

    it("should skip custom elements", () => {
      const html = `<div id="root"><div>content</div></div>`;
      const result = injectElementSelectors(html, { skipElements: ["div"] });

      assertEquals(result.includes("data-vf-selector"), false);
    });

    it("should inject selectors inside a full HTML document", () => {
      const html =
        `<!doctype html><html><head><title>t</title></head><body><div id="root"><p>Hi</p></div></body></html>`;
      const result = injectElementSelectors(html);

      assertEquals(
        /<p data-vf-selector="vf-p-\d+"/.test(result),
        true,
        "elements inside #root are annotated in a full document, the shape generateFullHTML passes",
      );
      assertEquals(
        result.includes('data-vf-selector="vf-title'),
        false,
        "head content stays unannotated",
      );
      assertEquals(
        result.includes("<html data-vf-selector"),
        false,
        "the html element itself stays unannotated",
      );
    });

    it("should not annotate markup inside ignored elements", () => {
      const scriptHtml = `<div id="root"><script>const marker = "<div>hi</div>";</script></div>`;

      assertEquals(
        injectElementSelectors(scriptHtml).includes("<div>hi</div>"),
        true,
        "tag-like text inside a script body is never rewritten",
      );
      assertEquals(
        injectElementSelectors(`<div id="root"><noscript><span>x</span></noscript></div>`)
          .includes("<span data-vf-selector"),
        false,
        "elements nested inside an ignored element are not annotated",
      );
    });

    it("should keep the attribute inside a self-closing tag", () => {
      const result = injectElementSelectors(`<div id="root"><img src="a.png" /></div>`);

      assertEquals(
        result,
        `<div id="root" data-vf-selector="vf-div-1"><img src="a.png"  data-vf-selector="vf-img-2"/></div>`,
        "self-closing tags must keep data-vf-selector before the />",
      );
      assertEquals(
        result.includes("/ data-vf-selector"),
        false,
        "the / must not become a stray attribute",
      );
    });
  });

  describe("isStudioEmbed", () => {
    it("should return true when studio_embed=true", () => {
      assertEquals(isStudioEmbed("http://localhost:3000?studio_embed=true"), true);
    });

    it("should return false when param is missing", () => {
      assertEquals(isStudioEmbed("http://localhost:3000"), false);
    });

    it("should return false when param is not true", () => {
      assertEquals(isStudioEmbed("http://localhost:3000?studio_embed=false"), false);
    });

    it("should accept URL object", () => {
      assertEquals(isStudioEmbed(new URL("http://localhost:3000?studio_embed=true")), true);
    });
  });
});
