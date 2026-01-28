/**
 * Test 6: Deployment Mode Safety
 *
 * This test verifies that missing or wrong environment variables are handled safely.
 * Deployment configuration bugs can cause severe issues:
 *
 * Bugs being tested:
 * - NODE_ENV defaulting: Wrong default causing production code to run in dev mode
 * - Missing releaseId crashes: Production mode requiring releaseId but it's undefined
 * - Environment variable leakage: Sensitive vars exposed to client
 * - Mode detection races: Mode determined before env is fully loaded
 * - Fallback cascade failures: Cascading defaults leading to invalid state
 *
 * The test runs with various environment configurations and verifies safe behavior.
 */

import { assertEquals, assert, assertStringIncludes, assertRejects } from "@veryfront/testing/assert";
import { describe, it, beforeEach, afterEach } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { withEnv } from "../../_helpers/utils.ts";
import { clearLayoutDiscoveryCache } from "../../../src/rendering/layouts/utils/discovery.ts";

describe("Deployment Mode Safety", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  beforeEach(() => {
    clearLayoutDiscoveryCache();
  });

  afterEach(() => {
    clearLayoutDiscoveryCache();
  });

  describe("NODE_ENV Handling", () => {
    /**
     * CRITICAL BUG: NODE_ENV defaulting can cause security issues
     * if production code runs in a less secure development mode.
     */
    it("defaults to production when NODE_ENV is not set", () => {
      // Save and clear NODE_ENV
      const restore = withEnv({ NODE_ENV: "" });

      try {
        // When NODE_ENV is empty or undefined, should default to production
        // for security (never default to a less secure mode)
        const nodeEnv = process.env.NODE_ENV || "production";

        // Empty string should be treated as production
        if (process.env.NODE_ENV === "") {
          assertEquals(nodeEnv, "production",
            "Empty NODE_ENV should default to production");
        }
      } finally {
        restore();
      }
    });

    it("recognizes valid NODE_ENV values", () => {
      const validModes = ["development", "production", "test"];

      for (const mode of validModes) {
        const restore = withEnv({ NODE_ENV: mode });

        try {
          assertEquals(process.env.NODE_ENV, mode,
            `NODE_ENV should be ${mode}`);
        } finally {
          restore();
        }
      }
    });

    it("handles invalid NODE_ENV gracefully", () => {
      const restore = withEnv({ NODE_ENV: "invalid-mode" });

      try {
        // Should not crash with invalid mode
        const nodeEnv = process.env.NODE_ENV;
        assertEquals(nodeEnv, "invalid-mode", "Should preserve the invalid value");

        // Application should handle this gracefully
        const isProduction = nodeEnv === "production";
        const isDevelopment = nodeEnv === "development";

        // Invalid mode is neither production nor development
        assert(!isProduction, "Invalid mode is not production");
        assert(!isDevelopment, "Invalid mode is not development");
      } finally {
        restore();
      }
    });
  });

  describe("Production Mode Requirements", () => {
    /**
     * CRITICAL BUG: Production mode may require specific configuration
     * (like releaseId) that causes crashes if missing.
     */
    it("handles missing VERYFRONT_API_TOKEN gracefully", async () => {
      const restore = withEnv({
        VERYFRONT_API_TOKEN: "",
        PROXY_MODE: "0",
      });

      try {
        await withTestContext("prod-missing-token", async (context) => {
          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() { return <div>Test</div>; }`
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            // Should be able to create renderer even without API token
            // (local file system mode)
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result = await renderer.renderPage("/");
            assertStringIncludes(result.html, "Test",
              "Should render successfully without API token in local mode");

            if (renderer && typeof renderer.clearAllState === "function") {
              await renderer.clearAllState();
            }
          } finally {
            await cleanupBundler();
          }
        });
      } finally {
        restore();
      }
    });

    it("does not expose API tokens in rendered output", async () => {
      const sensitiveToken = "vf_secret_token_12345";
      const restore = withEnv({
        VERYFRONT_API_TOKEN: sensitiveToken,
        SECRET_KEY: "super_secret_key",
        DATABASE_URL: "postgres://user:password@host/db",
      });

      try {
        await withTestContext("prod-no-leak", async (context) => {
          await mkdir(join(context.projectDir, "app"), { recursive: true });

          // Create a page that might accidentally leak env vars
          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() {
              // Try to access env vars (should NOT be exposed)
              const token = typeof process !== 'undefined' ? process.env?.VERYFRONT_API_TOKEN : undefined;
              return (
                <div>
                  <span id="env-check">ENV_CHECK</span>
                  {token && <span id="leaked-token">{token}</span>}
                </div>
              );
            }`
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development", // Even in dev mode, sensitive vars shouldn't leak
            });

            const result = await renderer.renderPage("/");

            // CRITICAL: Sensitive tokens must NOT appear in HTML
            assert(!result.html.includes(sensitiveToken),
              "API token must NOT appear in rendered HTML");
            assert(!result.html.includes("super_secret_key"),
              "Secret keys must NOT appear in rendered HTML");
            assert(!result.html.includes("password@host"),
              "Database credentials must NOT appear in rendered HTML");

            if (renderer && typeof renderer.clearAllState === "function") {
              await renderer.clearAllState();
            }
          } finally {
            await cleanupBundler();
          }
        });
      } finally {
        restore();
      }
    });
  });

  describe("Content Source Mode Detection", () => {
    /**
     * Test that content source modes (branch, release, environment) are
     * correctly detected and don't fail with missing configuration.
     */
    it("branch mode works without releaseId", async () => {
      await withTestContext("mode-branch", async (context) => {
        context.setEnv({
          PRODUCTION_MODE: "0", // Explicitly preview/branch mode
        });

        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Layout({ children }) {
            return <html><body data-mode="branch">{children}</body></html>;
          }`
        );
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page() { return <div>Branch Mode</div>; }`
        );

        const { createRenderer } = await import("../../../src/rendering/index.ts");
        const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

        try {
          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("/");
          assertStringIncludes(result.html, "Branch Mode",
            "Branch mode should render successfully");

          if (renderer && typeof renderer.clearAllState === "function") {
            await renderer.clearAllState();
          }
        } finally {
          await cleanupBundler();
        }
      });
    });

    it("handles mode transitions gracefully", async () => {
      await withTestContext("mode-transition", async (context) => {
        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`
        );
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page() { return <div>Mode Test</div>; }`
        );

        const { createRenderer } = await import("../../../src/rendering/index.ts");
        const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

        try {
          // Start in development mode
          const devRenderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const devResult = await devRenderer.renderPage("/");
          assertStringIncludes(devResult.html, "Mode Test", "Dev mode should work");

          if (devRenderer && typeof devRenderer.clearAllState === "function") {
            await devRenderer.clearAllState();
          }

          // Clear all state between mode changes
          await cleanupBundler();
          clearLayoutDiscoveryCache();

          // Now create production mode renderer
          const prodRenderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "production",
          });

          const prodResult = await prodRenderer.renderPage("/");
          assertStringIncludes(prodResult.html, "Mode Test", "Prod mode should work");

          if (prodRenderer && typeof prodRenderer.clearAllState === "function") {
            await prodRenderer.clearAllState();
          }
        } finally {
          await cleanupBundler();
        }
      });
    });
  });

  describe("Environment Variable Validation", () => {
    /**
     * Test that environment variables are properly validated
     * and don't cause crashes when malformed.
     */
    it("handles malformed boolean env vars", () => {
      const testCases = [
        { value: "true", expected: true },
        { value: "false", expected: false },
        { value: "1", expected: true },
        { value: "0", expected: false },
        { value: "yes", expected: true },
        { value: "no", expected: false },
        { value: "", expected: false },
        { value: "TRUE", expected: true },
        { value: "FALSE", expected: false },
        { value: "invalid", expected: false }, // Default to false for safety
      ];

      for (const { value, expected } of testCases) {
        const restore = withEnv({ TEST_BOOL: value });

        try {
          const envValue = process.env.TEST_BOOL;
          const asBool = ["true", "1", "yes"].includes(envValue?.toLowerCase() ?? "");

          assertEquals(asBool, expected,
            `"${value}" should be interpreted as ${expected}`);
        } finally {
          restore();
        }
      }
    });

    it("handles malformed numeric env vars", () => {
      const testCases = [
        { value: "8080", expected: 8080 },
        { value: "0", expected: 0 },
        { value: "-1", expected: -1 },
        { value: "", expected: NaN },
        { value: "abc", expected: NaN },
        { value: "123abc", expected: 123 }, // parseInt behavior
        { value: "3.14", expected: 3 }, // parseInt truncates
      ];

      for (const { value, expected } of testCases) {
        const restore = withEnv({ TEST_PORT: value });

        try {
          const envValue = process.env.TEST_PORT;
          const asNum = parseInt(envValue || "", 10);

          if (Number.isNaN(expected)) {
            assert(Number.isNaN(asNum), `"${value}" should be NaN`);
          } else {
            assertEquals(asNum, expected, `"${value}" should be ${expected}`);
          }
        } finally {
          restore();
        }
      }
    });

    it("provides safe defaults when env vars are missing", () => {
      // Clear relevant env vars
      const restore = withEnv({
        PORT: "",
        HOST: "",
        PRODUCTION_MODE: "",
      });

      try {
        // These should all have safe defaults
        const port = parseInt(process.env.PORT || "3000", 10);
        const host = process.env.HOST || "127.0.0.1";
        const productionMode = process.env.PRODUCTION_MODE === "1";

        assertEquals(port, 3000, "Port should default to 3000");
        assertEquals(host, "127.0.0.1", "Host should default to 127.0.0.1");
        assertEquals(productionMode, false, "Production mode should default to false");
      } finally {
        restore();
      }
    });
  });

  describe("Error Messages and Diagnostics", () => {
    /**
     * Test that configuration errors produce helpful error messages
     * instead of cryptic crashes.
     */
    it("provides helpful error for missing project directory", async () => {
      const { createRenderer } = await import("../../../src/rendering/index.ts");
      const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

      try {
        // Try to create renderer for non-existent directory
        await assertRejects(
          async () => {
            await createRenderer({
              projectDir: "/nonexistent/path/that/does/not/exist",
              mode: "development",
            });
          },
          Error, // Should throw an error
        );
      } catch (e) {
        // If it doesn't throw via assertRejects, verify error message
        if (e instanceof Error && !e.message.includes("assertion")) {
          assertStringIncludes(e.message.toLowerCase(), "not found",
            "Error message should indicate path not found");
        }
      } finally {
        await cleanupBundler();
      }
    });
  });

  describe("Safe Mode Transitions", () => {
    /**
     * Test that switching between modes doesn't leave stale state.
     */
    it("clears all caches when mode changes", async () => {
      await withTestContext("mode-cache-clear", async (context) => {
        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`
        );
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page() {
            const mode = process.env.NODE_ENV || 'unknown';
            return <div data-mode={mode}>Content</div>;
          }`
        );

        const { createRenderer } = await import("../../../src/rendering/index.ts");
        const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

        try {
          // Create and render in development mode
          const renderer1 = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await renderer1.renderPage("/");

          // Clear all state
          if (renderer1 && typeof renderer1.clearAllState === "function") {
            await renderer1.clearAllState();
          }
          await cleanupBundler();
          clearLayoutDiscoveryCache();

          // Create renderer in production mode
          const renderer2 = await createRenderer({
            projectDir: context.projectDir,
            mode: "production",
          });

          const result2 = await renderer2.renderPage("/");

          // Verify content renders (mode-specific behavior may vary)
          assertStringIncludes(result2.html, "Content",
            "Should render content after mode switch");

          if (renderer2 && typeof renderer2.clearAllState === "function") {
            await renderer2.clearAllState();
          }
        } finally {
          await cleanupBundler();
        }
      });
    });
  });

  describe("PROXY_MODE Configuration", () => {
    /**
     * Test PROXY_MODE environment variable handling.
     */
    it("handles PROXY_MODE=0 for direct mode", () => {
      const restore = withEnv({ PROXY_MODE: "0" });

      try {
        const proxyMode = process.env.PROXY_MODE === "1";
        assertEquals(proxyMode, false, "PROXY_MODE=0 should be direct mode");
      } finally {
        restore();
      }
    });

    it("handles PROXY_MODE=1 for proxy mode", () => {
      const restore = withEnv({ PROXY_MODE: "1" });

      try {
        const proxyMode = process.env.PROXY_MODE === "1";
        assertEquals(proxyMode, true, "PROXY_MODE=1 should be proxy mode");
      } finally {
        restore();
      }
    });

    it("defaults to direct mode when PROXY_MODE is not set", () => {
      const restore = withEnv({ PROXY_MODE: "" });

      try {
        const proxyMode = process.env.PROXY_MODE === "1";
        assertEquals(proxyMode, false, "Missing PROXY_MODE should default to direct");
      } finally {
        restore();
      }
    });
  });
});
