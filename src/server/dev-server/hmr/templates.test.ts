import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHMRClientTemplate } from "./templates.ts";

describe("server/dev-server/hmr/templates", () => {
  describe("generateHMRClientTemplate", () => {
    function getCode(
      port: number,
      hostname: string,
      reloadDelay: number,
    ): string {
      return generateHMRClientTemplate(port, hostname, reloadDelay);
    }

    it("should include the port number", () => {
      assertEquals(getCode(3001, "localhost", 2000).includes("3001"), true);
    });

    it("should include the hostname", () => {
      assertEquals(getCode(8080, "myhost", 2000).includes("myhost"), true);
    });

    it("should include the reload delay", () => {
      assertEquals(getCode(3000, "localhost", 5000).includes("5000"), true);
    });

    it("should create a WebSocket connection", () => {
      assertEquals(getCode(3000, "localhost", 2000).includes("new WebSocket"), true);
    });

    it("should handle CSS updates", () => {
      const code = getCode(3000, "localhost", 2000);
      assertEquals(code.includes(".css"), true);
      assertEquals(code.includes("refreshTailwindCSS"), true);
    });

    it("should handle JS module updates", () => {
      assertEquals(getCode(3000, "localhost", 2000).includes("updateJS"), true);
    });

    it("should notify Studio parent frame", () => {
      const code = getCode(3000, "localhost", 2000);
      assertEquals(code.includes("postMessage"), true);
      assertEquals(code.includes("appUpdated"), true);
    });

    it("should handle beforeunload cleanup", () => {
      assertEquals(getCode(3000, "localhost", 2000).includes("beforeunload"), true);
    });
  });
});
