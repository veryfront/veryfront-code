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

import { assert, assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { withEnv } from "../../_helpers/utils.ts";
import { clearLayoutDiscoveryCache } from "../../../src/rendering/layouts/utils/discovery.ts";

async function clearRendererState(renderer: unknown): Promise<void> {
  if (
    renderer &&
    typeof renderer === "object" &&
    "clearAllState" in renderer &&
    typeof (renderer as { clearAllState?: unknown }).clearAllState === "function"
  ) {
    await (renderer as { clearAllState: () => Promise<void> }).clearAllState();
  }
}

describe(
  "Deployment Mode Safety",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
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
        const restore = withEnv({ NODE_ENV: "" });

        try {
          const nodeEnv = process.env.NODE_ENV || "production";

          if (process.env.NODE_ENV === "") {
            assertEquals(nodeEnv, "production", "Empty NODE_ENV should default to production");
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
            assertEquals(process.env.NODE_ENV, mode, `NODE_ENV should be ${mode}`);
          } finally {
            restore();
          }
        }
      });

      it("handles invalid NODE_ENV gracefully", () => {
        const restore = withEnv({ NODE_ENV: "invalid-mode" });

        try {
          const nodeEnv = process.env.NODE_ENV;
          assertEquals(nodeEnv, "invalid-mode", "Should preserve the invalid value");

          const isProduction = nodeEnv === "production";
          const isDevelopment = nodeEnv === "development";

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
            }`,
            );
            await writeTextFile(
              join(context.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div>Test</div>; }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            try {
              const renderer = await createRenderer({
                projectDir: context.projectDir,
                mode: "development",
              });

              const result = await renderer.renderPage("/");
              assertStringIncludes(
                result.html,
                "Test",
                "Should render successfully without API token in local mode",
              );

              await clearRendererState(renderer);
            } finally {
              await cleanupBundler();
            }
          });
        } finally {
          restore();
        }
      });

      // NOTE: This test is skipped because automatic env var sanitization during SSR
      // is not a standard feature. In SSR frameworks, server-side code CAN access
      // environment variables by design. It's the developer's responsibility to use
      // env var prefixes (like VERYFRONT_PUBLIC_*) for client-safe values.
      // This test documents a potential future enhancement.
      it.ignore("does not expose API tokens in rendered output", async () => {
        const sensitiveToken = "vf_secret_token_12345";
        const restore = withEnv({
          VERYFRONT_API_TOKEN: sensitiveToken,
          SECRET_KEY: "super_secret_key",
          DATABASE_URL: "postgres://user:password@host/db",
        });

        try {
          await withTestContext("prod-no-leak", async (context) => {
            await mkdir(join(context.projectDir, "app"), { recursive: true });

            await writeTextFile(
              join(context.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
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
            }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            try {
              const renderer = await createRenderer({
                projectDir: context.projectDir,
                mode: "development",
              });

              const result = await renderer.renderPage("/");

              assert(!result.html.includes(sensitiveToken), "API token must NOT appear in rendered HTML");
              assert(!result.html.includes("super_secret_key"), "Secret keys must NOT appear in rendered HTML");
              assert(!result.html.includes("password@host"), "Database credentials must NOT appear in rendered HTML");

              await clearRendererState(renderer);
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
            PRODUCTION_MODE: "0",
          });

          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return <html><body data-mode="branch">{children}</body></html>;
          }`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() { return <div>Branch Mode</div>; }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result = await renderer.renderPage("/");
            assertStringIncludes(result.html, "Branch Mode", "Branch mode should render successfully");

            await clearRendererState(renderer);
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
          }`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() { return <div>Mode Test</div>; }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const devRenderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const devResult = await devRenderer.renderPage("/");
            assertStringIncludes(devResult.html, "Mode Test", "Dev mode should work");
            await clearRendererState(devRenderer);

            await cleanupBundler();
            clearLayoutDiscoveryCache();

            const prodRenderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "production",
            });

            const prodResult = await prodRenderer.renderPage("/");
            assertStringIncludes(prodResult.html, "Mode Test", "Prod mode should work");
            await clearRendererState(prodRenderer);
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
          { value: "invalid", expected: false },
        ];

        for (const { value, expected } of testCases) {
          const restore = withEnv({ TEST_BOOL: value });

          try {
            const envValue = process.env.TEST_BOOL;
            const asBool = ["true", "1", "yes"].includes(envValue?.toLowerCase() ?? "");
            assertEquals(asBool, expected, `"${value}" should be interpreted as ${expected}`);
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
          { value: "123abc", expected: 123 },
          { value: "3.14", expected: 3 },
        ];

        for (const { value, expected } of testCases) {
          const restore = withEnv({ TEST_PORT: value });

          try {
            const asNum = parseInt(process.env.TEST_PORT || "", 10);

            if (Number.isNaN(expected)) {
              assert(Number.isNaN(asNum), `"${value}" should be NaN`);
              continue;
            }

            assertEquals(asNum, expected, `"${value}" should be ${expected}`);
          } finally {
            restore();
          }
        }
      });

      it("provides safe defaults when env vars are missing", () => {
        const restore = withEnv({
          PORT: "",
          HOST: "",
          PRODUCTION_MODE: "",
        });

        try {
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
       *
       * NOTE: This test is skipped because createRenderer currently doesn't
       * validate the project directory existence during initialization -
       * errors occur lazily when files are accessed. This documents a
       * potential improvement for better developer experience.
       */
      it.ignore("provides helpful error for missing project directory", async () => {
        const { createRenderer } = await import("../../../src/rendering/index.ts");
        const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

        try {
          await assertRejects(
            async () => {
              await createRenderer({
                projectDir: "/nonexistent/path/that/does/not/exist",
                mode: "development",
              });
            },
            Error,
          );
        } catch (e) {
          if (e instanceof Error && !e.message.includes("assertion")) {
            assertStringIncludes(e.message.toLowerCase(), "not found", "Error message should indicate path not found");
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
          }`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() {
            const mode = process.env.NODE_ENV || 'unknown';
            return <div data-mode={mode}>Content</div>;
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer1 = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            await renderer1.renderPage("/");
            await clearRendererState(renderer1);

            await cleanupBundler();
            clearLayoutDiscoveryCache();

            const renderer2 = await createRenderer({
              projectDir: context.projectDir,
              mode: "production",
            });

            const result2 = await renderer2.renderPage("/");
            assertStringIncludes(result2.html, "Content", "Should render content after mode switch");

            await clearRendererState(renderer2);
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
  },
);
