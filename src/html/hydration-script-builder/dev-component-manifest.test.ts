import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
      const result = generateDevComponentManifestScript({ dev: {} } as any);
      assertEquals(result.includes("window.__veryfrontComponents = []"), true);
    });

    it("should JSON-serialize the components array", () => {
      const config = {
        dev: {
          components: [{ name: "Test", path: "/components/test.tsx" }],
        },
      };
      const result = generateDevComponentManifestScript(config as any);
      assertEquals(result.includes(JSON.stringify(config.dev.components)), true);
    });

    it("should escape component metadata that could close the script", () => {
      const result = generateDevComponentManifestScript({
        dev: {
          components: [{
            name: "</script><script>globalThis.__veryfrontManifestBreakout = true</script>",
          }],
        },
      } as any);

      assertEquals(result.includes("</script><script>"), false);
      assertEquals(result.includes("\\u003c/script"), true);
    });

    it("rejects component manifests that exceed the entry limit", () => {
      assertThrows(
        () =>
          generateDevComponentManifestScript({
            dev: {
              components: Array.from({ length: 1_001 }, (_, index) => `Component${index}`),
            },
          } as never),
        TypeError,
        "entry limit",
      );
    });

    it("does not execute config or component accessors", () => {
      let configAccessorCalls = 0;
      const config: Record<string, unknown> = {};
      Object.defineProperty(config, "dev", {
        enumerable: true,
        get() {
          configAccessorCalls++;
          return { components: [] };
        },
      });
      assertThrows(
        () => generateDevComponentManifestScript(config as never),
        TypeError,
        "config must not contain accessor properties",
      );
      assertEquals(configAccessorCalls, 0);

      let componentAccessorCalls = 0;
      const component: Record<string, unknown> = {};
      Object.defineProperty(component, "name", {
        enumerable: true,
        get() {
          componentAccessorCalls++;
          return "Private";
        },
      });
      assertThrows(
        () =>
          generateDevComponentManifestScript({
            dev: { components: [component] },
          } as never),
        TypeError,
        "accessor properties",
      );
      assertEquals(componentAccessorCalls, 0);
    });

    it("rejects cyclic component metadata", () => {
      const component: Record<string, unknown> = {};
      component.self = component;

      assertThrows(
        () =>
          generateDevComponentManifestScript({
            dev: { components: [component] },
          } as never),
        TypeError,
        "cycles",
      );
    });
  });
});
