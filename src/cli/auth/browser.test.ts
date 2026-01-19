/**
 * Browser Utility Tests
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTestRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { canOpenBrowser } from "./browser.ts";

describe("Browser Utility", () => {
  describe("canOpenBrowser", () => {
    it("should return boolean", () => {
      const result = canOpenBrowser();
      assertEquals(typeof result, "boolean");
    });

    it("should detect CI environment", () => {
      const testEnv = createTestRuntimeEnv({ ci: true });
      const result = canOpenBrowser(testEnv);
      assertEquals(result, false);
    });

    it("should detect SSH session", () => {
      const testEnv = createTestRuntimeEnv({ sshClient: "192.168.1.1 12345 22" });
      const result = canOpenBrowser(testEnv);
      assertEquals(result, false);
    });

    it("should return true in normal environment", () => {
      const testEnv = createTestRuntimeEnv({
        ci: false,
        continuousIntegration: false,
        sshClient: undefined,
        sshTty: undefined,
        display: "mock-display", // For Linux compatibility
      });
      const result = canOpenBrowser(testEnv);
      assertEquals(result, true);
    });
  });
});
