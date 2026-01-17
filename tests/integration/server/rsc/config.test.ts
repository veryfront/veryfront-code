/**
 * RSC Flag Tests
 *
 * Tests React Server Components (RSC) feature flag behavior:
 * - RSC endpoints are disabled by default
 * - RSC endpoints are enabled with experimental.rsc config
 * - All RSC endpoints work correctly when enabled
 */

import { assert, assertEquals } from "@std/assert";
import { afterAll, describe, it } from "@std/testing/bdd.ts";
import { join } from "@std/path";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Config Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  it("RSC - endpoints are disabled by default", async () => {
    /**
     * Verifies RSC endpoints return 404 when feature flag is not set
     * This ensures RSC is opt-in only
     */
    await withTestContext("rsc-disabled", async (context) => {
      // Explicitly disable RSC in config to ensure isolation from other tests
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: false } };`,
      );

      // Create minimal project structure
      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home Page");

      const server = await context.createProductionServer();

      // Test RSC probe endpoint
      const response = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/probe`);
      assertEquals(response.status, 404, "RSC probe should return 404 when disabled");

      // Consume response body
      await response.text();
    });
  });

  it("RSC - endpoints are enabled with config flag", async () => {
    /**
     * Verifies all RSC endpoints work when experimental.rsc is enabled:
     * - /probe - health check
     * - /payload - multi-slot payload
     * - /manifest - route manifest
     * - /flight_page - RSC streaming
     * - /page - page shell
     */
    await withTestContext("rsc-enabled", async (context) => {
      // Enable RSC via config file (not env var - for parallel test isolation)
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      // Create App Router structure for RSC
      await Deno.writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
          return (
            <html>
              <body>{children}</body>
            </html>
          );
        }`,
      );

      await Deno.mkdir(join(context.projectDir, "app", "hello"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(context.projectDir, "app", "hello", "page.tsx"),
        `export default function HelloPage({ searchParams }: { searchParams: { name?: string } }) {
          const name = searchParams?.name || 'World';
          return (
            <div>
              <h1>Hello {name}</h1>
              <p>DB: hello {name}</p>
            </div>
          );
        }`,
      );

      // Add API route for manifest
      await Deno.mkdir(join(context.projectDir, "app", "api", "echo"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(context.projectDir, "app", "api", "echo", "route.ts"),
        `export const GET = () => Response.json({ ok: true });`,
      );

      const server = await context.createProductionServer();

      // Test 1: RSC probe endpoint
      const probeResponse = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/probe`);
      assertEquals(probeResponse.status, 200, "RSC probe should return 200 when enabled");
      await probeResponse.text();

      // Test 2: Payload endpoint (multi-slot)
      const payloadResponse = await fetch(
        `http://127.0.0.1:${server.port}/_veryfront/rsc/payload`,
      );
      assertEquals(payloadResponse.status, 200, "Payload endpoint should return 200");
      const payload = await payloadResponse.json();

      assert(typeof payload === "object" && payload !== null, "Payload should be an object");
      assert(
        Array.isArray(payload.modules) && payload.modules.length > 0,
        "Payload should contain module references",
      );
      assert(
        payload.slots && typeof payload.slots.root === "string",
        "Payload should include root slot",
      );

      // Test 3: Parameterized payload
      const paramResponse = await fetch(
        `http://127.0.0.1:${server.port}/_veryfront/rsc/payload?name=Alice`,
      );
      assertEquals(paramResponse.status, 200, "Parameterized payload should return 200");
      const paramPayload = await paramResponse.json();

      assert(typeof paramPayload?.html === "string", "Parameterized payload should include HTML");
      assert(paramPayload.html.includes("Hello Alice"), "Should render with parameter");

      // Test 4: Manifest endpoint
      const manifestResponse = await fetch(
        `http://127.0.0.1:${server.port}/_veryfront/rsc/manifest`,
      );
      assertEquals(manifestResponse.status, 200, "Manifest endpoint should return 200");
      const manifest = await manifestResponse.json();
      assert(typeof manifest === "object" && manifest !== null, "Manifest should be an object");

      // Test 5: Flight endpoint (RSC streaming)
      const flightResponse = await fetch(
        `http://127.0.0.1:${server.port}/_veryfront/rsc/flight_page?name=Zed`,
      );

      if (flightResponse.status === 200) {
        const flightText = await flightResponse.text();
        assert(
          flightText.includes("Hello Zed from Flight"),
          "Flight stream should include server-rendered content",
        );
      } else {
        // Runtime might not support RSC server yet
        assert(
          flightResponse.status === 410 || flightResponse.status === 501,
          `Flight endpoint should return 200, 410, or 501, got ${flightResponse.status}`,
        );

        const contentType = flightResponse.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const error = await flightResponse.json();
          assertEquals(error.ok, false, "Should indicate error for unavailable Flight");
        } else {
          await flightResponse.text();
        }
      }

      // Test 6: Page shell endpoint
      const pageResponse = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/page`);
      assertEquals(pageResponse.status, 200, "Page shell endpoint should return 200");
      await pageResponse.text();
    });
  });
});
