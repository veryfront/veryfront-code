/**
 * Browser Utility Tests
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { canOpenBrowser } from "./browser.ts";

describe("Browser Utility", () => {
  describe("canOpenBrowser", () => {
    it("should return boolean", () => {
      assertEquals(typeof canOpenBrowser(), "boolean");
    });

    it("should detect CI environment", () => {
      assertEquals(canOpenBrowser(createTestEnvironmentConfig({ ci: true })), false);
    });

    it("should detect SSH session", () => {
      assertEquals(
        canOpenBrowser(createTestEnvironmentConfig({ sshClient: "192.168.1.1 12345 22" })),
        false,
      );
    });

    it("should return true in normal environment", () => {
      assertEquals(
        canOpenBrowser(
          createTestEnvironmentConfig({
            ci: false,
            continuousIntegration: false,
            sshClient: undefined,
            sshTty: undefined,
            display: "mock-display", // For Linux compatibility
          }),
        ),
        true,
      );
    });
  });
});
