/**
 * RSC Flag Tests
 *
 * Tests React Server Components (RSC) feature flag behavior:
 * - RSC endpoints are disabled by default
 * - RSC endpoints are enabled with experimental.rsc config
 * - All RSC endpoints work correctly when enabled
 */

import { assert, assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Config Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  it("RSC - endpoints are disabled by default", async () => {
    await withTestContext("rsc-disabled", async (context) => {
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: false } };`,
      );

      await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home Page");

      const server = await context.createProductionServer();

      const response = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/probe`);
      assertEquals(response.status, 404, "RSC probe should return 404 when disabled");
      await response.text();
    });
  });

  it("RSC - endpoints are enabled with config flag", async () => {
    await withTestContext("rsc-enabled", async (context) => {
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      await writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
          return (
            <html>
              <body>{children}</body>
            </html>
          );
        }`,
      );

      await mkdir(join(context.projectDir, "app", "hello"), { recursive: true });
      await writeTextFile(
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

      await mkdir(join(context.projectDir, "app", "api", "echo"), { recursive: true });
      await writeTextFile(
        join(context.projectDir, "app", "api", "echo", "route.ts"),
        `export const GET = () => Response.json({ ok: true });`,
      );

      const server = await context.createProductionServer();
      const baseUrl = `http://127.0.0.1:${server.port}/_veryfront/rsc`;

      const probeResponse = await fetch(`${baseUrl}/probe`);
      assertEquals(probeResponse.status, 200, "RSC probe should return 200 when enabled");
      await probeResponse.text();

      const payloadResponse = await fetch(`${baseUrl}/payload`);
      assertEquals(payloadResponse.status, 200, "Payload endpoint should return 200");
      const payload = await payloadResponse.json();

      assert(typeof payload === "object" && payload !== null, "Payload should be an object");
      assert(
        Array.isArray(payload.modules) && payload.modules.length > 0,
        "Payload should contain module references",
      );
      assert(payload.slots && typeof payload.slots.root === "string", "Payload should include root slot");

      const paramResponse = await fetch(`${baseUrl}/payload?name=Alice`);
      assertEquals(paramResponse.status, 200, "Parameterized payload should return 200");
      const paramPayload = await paramResponse.json();

      assert(typeof paramPayload?.html === "string", "Parameterized payload should include HTML");
      assert(paramPayload.html.includes("Hello Alice"), "Should render with parameter");

      const manifestResponse = await fetch(`${baseUrl}/manifest`);
      assertEquals(manifestResponse.status, 200, "Manifest endpoint should return 200");
      const manifest = await manifestResponse.json();
      assert(typeof manifest === "object" && manifest !== null, "Manifest should be an object");

      const flightResponse = await fetch(`${baseUrl}/flight_page?name=Zed`);
      if (flightResponse.status === 200) {
        const flightText = await flightResponse.text();
        assert(
          flightText.includes("Hello Zed from Flight"),
          "Flight stream should include server-rendered content",
        );
      } else {
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

      const pageResponse = await fetch(`${baseUrl}/page`);
      assertEquals(pageResponse.status, 200, "Page shell endpoint should return 200");
      await pageResponse.text();
    });
  });
});
