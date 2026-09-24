import "#veryfront/schemas/_test-setup.ts";
/**
 * Browser Utility Tests
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { canOpenBrowser, openBrowser } from "./browser.ts";

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

describe("bounded browser launch", () => {
  it("rejects cancellation and elapsed budgets before creating a launcher", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await assertRejects(
      () => openBrowser("https://synthetic.example.test", { signal: controller.signal }),
      DOMException,
      "cancelled",
    );
    await assertRejects(
      () => openBrowser("https://synthetic.example.test", { timeoutMs: 0 }),
      Error,
      "deadline elapsed",
    );
  });
});
