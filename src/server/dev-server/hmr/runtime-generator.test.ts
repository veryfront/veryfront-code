import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHMRRuntimeScript } from "./runtime-generator.ts";

describe("server/dev-server/hmr/runtime-generator", () => {
  describe("generateHMRRuntimeScript", () => {
    it("should return a string containing the IIFE wrapper", () => {
      const script = generateHMRRuntimeScript({ port: 3001 });
      assertEquals(script.includes("(function()"), true);
      assertEquals(script.includes("})();"), true);
    });

    it("should include a comment header", () => {
      const script = generateHMRRuntimeScript({ port: 3001 });
      assertEquals(script.startsWith("// Veryfront HMR Runtime"), true);
    });

    it("should include the specified port", () => {
      const script = generateHMRRuntimeScript({ port: 8080 });
      assertEquals(script.includes("8080"), true);
    });

    it("should include 127.0.0.1 as the default hostname", () => {
      const script = generateHMRRuntimeScript({ port: 3001 });
      assertEquals(script.includes("127.0.0.1"), true);
    });

    it("should produce different scripts for different ports", () => {
      const script1 = generateHMRRuntimeScript({ port: 3001 });
      const script2 = generateHMRRuntimeScript({ port: 8080 });
      assertEquals(script1 !== script2, true);
    });

    it("should include WebSocket creation logic", () => {
      const script = generateHMRRuntimeScript({ port: 3001 });
      assertEquals(script.includes("WebSocket"), true);
    });
  });
});
