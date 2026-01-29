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
      // The inner div with data-vf-ignore should not get a new selector
      assertEquals(
        (result.match(/data-vf-selector/g) || []).length,
        1, // only the root div gets a selector
      );
    });

    it("should handle void elements", () => {
      const html = `<div id="root"><img src="test.png"><br></div>`;
      const result = injectElementSelectors(html);
      assertEquals(result.includes('data-vf-selector="vf-img-'), true);
    });

    it("should skip custom elements", () => {
      const html = `<div id="root"><div>content</div></div>`;
      const result = injectElementSelectors(html, { skipElements: ["div"] });
      // Both divs should be skipped
      assertEquals(result.includes("data-vf-selector"), false);
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
