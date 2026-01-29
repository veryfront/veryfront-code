import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHMRClientTemplate } from "./templates.ts";

describe("server/dev-server/hmr/templates", () => {
  describe("generateHMRClientTemplate", () => {
    it("should include the port number", () => {
      const code = generateHMRClientTemplate(3001, "localhost", 2000);
      assertEquals(code.includes("3001"), true);
    });

    it("should include the hostname", () => {
      const code = generateHMRClientTemplate(8080, "myhost", 2000);
      assertEquals(code.includes("myhost"), true);
    });

    it("should include the reload delay", () => {
      const code = generateHMRClientTemplate(3000, "localhost", 5000);
      assertEquals(code.includes("5000"), true);
    });

    it("should create a WebSocket connection", () => {
      const code = generateHMRClientTemplate(3000, "localhost", 2000);
      assertEquals(code.includes("new WebSocket"), true);
    });

    it("should handle CSS updates", () => {
      const code = generateHMRClientTemplate(3000, "localhost", 2000);
      assertEquals(code.includes(".css"), true);
      assertEquals(code.includes("refreshTailwindCSS"), true);
    });

    it("should handle JS module updates", () => {
      const code = generateHMRClientTemplate(3000, "localhost", 2000);
      assertEquals(code.includes("updateJS"), true);
    });

    it("should notify Studio parent frame", () => {
      const code = generateHMRClientTemplate(3000, "localhost", 2000);
      assertEquals(code.includes("postMessage"), true);
      assertEquals(code.includes("appUpdated"), true);
    });

    it("should handle beforeunload cleanup", () => {
      const code = generateHMRClientTemplate(3000, "localhost", 2000);
      assertEquals(code.includes("beforeunload"), true);
    });
  });
});
