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
      assertEquals(typeof canOpenBrowser(), "boolean");
    });

    it("should detect CI environment", () => {
      const testEnv = createTestRuntimeEnv({ ci: true });
      assertEquals(canOpenBrowser(testEnv), false);
    });

    it("should detect SSH session", () => {
      const testEnv = createTestRuntimeEnv({ sshClient: "192.168.1.1 12345 22" });
      assertEquals(canOpenBrowser(testEnv), false);
    });

    it("should return true in normal environment", () => {
      const testEnv = createTestRuntimeEnv({
        ci: false,
        continuousIntegration: false,
        sshClient: undefined,
        sshTty: undefined,
        display: "mock-display", // For Linux compatibility
      });

      assertEquals(canOpenBrowser(testEnv), true);
    });
  });
});
