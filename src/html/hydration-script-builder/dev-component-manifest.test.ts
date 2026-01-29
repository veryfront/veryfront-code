import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateDevComponentManifestScript } from "./dev-component-manifest.ts";

describe("hydration-script-builder/dev-component-manifest", () => {
  describe("generateDevComponentManifestScript", () => {
    it("should return a script tag", () => {
      const result = generateDevComponentManifestScript({});
      assertEquals(result.includes("<script"), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should not be a module script tag", () => {
      const result = generateDevComponentManifestScript({});
      assertEquals(result.includes('type="module"'), false);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateDevComponentManifestScript({}, "nonce-val");
      assertEquals(result.includes('nonce="nonce-val"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateDevComponentManifestScript({});
      assertEquals(result.includes("nonce="), false);
    });

    it("should set window.__veryfrontComponents with empty array when no components", () => {
      const result = generateDevComponentManifestScript({});
      assertEquals(result.includes("window.__veryfrontComponents = []"), true);
    });

    it("should set window.__veryfrontComponents from config.dev.components", () => {
      const config = {
        dev: {
          components: [{ name: "Button" }, { name: "Card" }],
        },
      };
      const result = generateDevComponentManifestScript(config as any);
      assertEquals(result.includes("window.__veryfrontComponents"), true);
      assertEquals(result.includes("Button"), true);
      assertEquals(result.includes("Card"), true);
    });

    it("should handle config with dev but no components", () => {
      const config = { dev: {} };
      const result = generateDevComponentManifestScript(config as any);
      assertEquals(result.includes("window.__veryfrontComponents = []"), true);
    });

    it("should JSON-serialize the components array", () => {
      const config = {
        dev: {
          components: [{ name: "Test", path: "/components/test.tsx" }],
        },
      };
      const result = generateDevComponentManifestScript(config as any);
      const expected = JSON.stringify(config.dev.components);
      assertEquals(result.includes(expected), true);
    });
  });
});
