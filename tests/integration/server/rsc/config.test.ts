
import { assert, assertEquals } from "std/assert/mod.ts";
import { afterAll } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

Deno.test({
  name: "RSC - endpoints are disabled by default",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  await withTestContext("rsc-disabled", async (context) => {
    // NOTE: We explicitly DO NOT set VERYFRONT_EXPERIMENTAL_RSC here
    context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

    await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home Page");

    const server = await context.createProductionServer();

    const response = await fetch(`http://localhost:${server.port}/_veryfront/rsc/probe`);
    assertEquals(response.status, 404, "RSC probe should return 404 when disabled");

    await response.text();
  });
});

Deno.test({
  name: "RSC - endpoints are enabled with feature flag",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
    await withTestContext("rsc-enabled", async (context) => {
      context.setEnv({
        VERYFRONT_EXPERIMENTAL_RSC: "1",
        VF_CACHE_ALLOW_CLOSE: "1",
      });
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

        await Deno.mkdir(join(context.projectDir, "app", "api", "echo"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "api", "echo", "route.ts"),
          `export const GET = () => Response.json({ ok: true });`,
        );

        const server = await context.createProductionServer();

        const probeResponse = await fetch(`http://localhost:${server.port}/_veryfront/rsc/probe`);
        assertEquals(probeResponse.status, 200, "RSC probe should return 200 when enabled");
        await probeResponse.text();

        const payloadResponse = await fetch(
          `http://localhost:${server.port}/_veryfront/rsc/payload`,
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

        const paramResponse = await fetch(
          `http://localhost:${server.port}/_veryfront/rsc/payload?name=Alice`,
        );
        assertEquals(paramResponse.status, 200, "Parameterized payload should return 200");
        const paramPayload = await paramResponse.json();

        assert(typeof paramPayload?.html === "string", "Parameterized payload should include HTML");
        assert(paramPayload.html.includes("Hello Alice"), "Should render with parameter");

        const manifestResponse = await fetch(
          `http://localhost:${server.port}/_veryfront/rsc/manifest`,
        );
        assertEquals(manifestResponse.status, 200, "Manifest endpoint should return 200");
        const manifest = await manifestResponse.json();
        assert(typeof manifest === "object" && manifest !== null, "Manifest should be an object");

        const flightResponse = await fetch(
          `http://localhost:${server.port}/_veryfront/rsc/flight_page?name=Zed`,
        );

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

        const pageResponse = await fetch(`http://localhost:${server.port}/_veryfront/rsc/page`);
        assertEquals(pageResponse.status, 200, "Page shell endpoint should return 200");
        await pageResponse.text();
  });
});
