import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { generateDevComponentManifestScript } from "./dev-component-manifest.ts";
import type { VeryfrontConfig } from "@veryfront/config";

describe("dev-component-manifest", () => {
  describe("generateDevComponentManifestScript", () => {
    it("should generate script without nonce", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: ["Button", "Card"],
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes("<script>"));
      assert(!script.includes('nonce="'));
      assert(script.includes("</script>"));
    });

    it("should generate script with nonce attribute", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: [],
        },
      } as VeryfrontConfig;
      const nonce = "test-nonce-789";

      const script = generateDevComponentManifestScript(config, nonce);

      assert(script.includes(`<script nonce="${nonce}">`));
    });

    it("should embed component manifest as JSON", () => {
      const components = ["Header", "Footer", "Navigation"];
      const config: VeryfrontConfig = {
        dev: {
          components,
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes("window.__veryfrontComponents"));
      assert(script.includes(JSON.stringify(components)));
    });

    it("should handle empty components array", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: [],
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes("window.__veryfrontComponents = []"));
    });

    it("should handle config without dev property", () => {
      const config: VeryfrontConfig = {} as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes("window.__veryfrontComponents = []"));
    });

    it("should handle config with dev but no components", () => {
      const config: VeryfrontConfig = {
        dev: {},
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes("window.__veryfrontComponents = []"));
    });

    it("should properly escape component names in JSON", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: ['Component"With"Quotes', "Component'With'Apostrophe"],
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      // JSON.stringify should escape these properly
      assert(script.includes("window.__veryfrontComponents"));
      const jsonMatch = script.match(/window\.__veryfrontComponents = (.+);/);
      assert(jsonMatch !== null);

      // Should be valid JSON
      const parsed = JSON.parse(jsonMatch![1]!);
      assertEquals(parsed.length, 2);
    });

    it("should handle single component", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: ["SingleComponent"],
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes('["SingleComponent"]'));
    });

    it("should handle many components", () => {
      const components = Array.from({ length: 100 }, (_, i) => `Component${i}`);
      const config: VeryfrontConfig = {
        dev: {
          components,
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      assert(script.includes("window.__veryfrontComponents"));
      assert(script.includes("Component0"));
      assert(script.includes("Component99"));
    });

    it("should create valid JavaScript assignment", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: ["Test"],
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config);

      // Extract the script content
      const contentMatch = script.match(/<script[^>]*>([\s\S]*)<\/script>/);
      assert(contentMatch !== null);

      // Should contain a valid variable assignment
      assert(contentMatch![1]!.includes("window.__veryfrontComponents ="));
    });

    it("should handle special characters in nonce", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: [],
        },
      } as VeryfrontConfig;
      const nonce = "abc-123_XYZ/+=";

      const script = generateDevComponentManifestScript(config, nonce);

      assert(script.includes(`nonce="${nonce}"`));
    });

    it("should handle empty string nonce", () => {
      const config: VeryfrontConfig = {
        dev: {
          components: [],
        },
      } as VeryfrontConfig;

      const script = generateDevComponentManifestScript(config, "");

      assert(!script.includes('nonce=""'));
      assert(script.includes("<script>"));
    });
  });
});
