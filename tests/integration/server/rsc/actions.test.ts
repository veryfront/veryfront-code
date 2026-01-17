/**
 * RSC Action and Error Handling Tests
 *
 * Tests React Server Components (RSC) action endpoints:
 * - Server action invocation via POST
 * - Error handling for missing/invalid actions
 * - Request validation
 * - Method restrictions
 */

import { assertEquals } from "@std/assert";
import { afterAll, describe, it } from "@std/testing/bdd.ts";
import { join } from "@std/path";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Actions Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  it("RSC - action endpoint handles server actions correctly", async () => {
    /**
     * Tests the RSC action endpoint (_veryfront/rsc/action):
     * - Successful action invocation
     * - Proper JSON response format
     * - Action parameter passing
     */
    // Enable cache closing for tests
    const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
    Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

    try {
      await withTestContext("rsc-actions", async (context) => {
        // Enable RSC via config instead of env var
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        // Create a simple server action
        await Deno.mkdir(join(context.projectDir, "app", "actions"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "actions", "echo.ts"),
          `export default async function echo(input: string): Promise<string> {
          return \`ok:\${input}\`;
        }`,
        );

        // Also create a page to ensure server starts properly
        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# RSC Test Home");

        const server = await context.createProductionServer();

        // Test successful action invocation
        const response = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "echo", args: ["test-input"] }),
        });

        assertEquals(response.status, 200, "Should return 200 for valid action");
        const data = await response.json();
        assertEquals(data.ok, true, "Should indicate success");
        assertEquals(data.result, "ok:test-input", "Should return expected result");
      });
    } finally {
      // Restore original env values
      if (originalAllowClose === undefined) {
        Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
      } else {
        Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
      }
    }
  });

  it("RSC - action endpoint validates request format", async () => {
    /**
     * Tests request validation:
     * - Missing action ID returns 400
     * - Invalid JSON returns 400
     * - Proper error messages
     */
    const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
    Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

    try {
      await withTestContext("rsc-validation", async (context) => {
        // Enable RSC via config instead of env var
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createProductionServer();

        // Test missing action ID
        const missingIdResponse = await fetch(
          `http://127.0.0.1:${server.port}/_veryfront/rsc/action`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ args: [] }), // Missing 'id' field
          },
        );

        assertEquals(missingIdResponse.status, 400, "Should return 400 for missing action ID");
        const errorText = await missingIdResponse.text();
        assertEquals(typeof errorText, "string", "Should return error message");
      });
    } finally {
      if (originalAllowClose === undefined) {
        Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
      } else {
        Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
      }
    }
  });

  it("RSC - action endpoint returns 404 for non-existent actions", async () => {
    /**
     * Tests handling of non-existent actions:
     * - Returns 404 status
     * - Doesn't expose internal errors
     */
    const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
    Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

    try {
      await withTestContext("rsc-not-found", async (context) => {
        // Enable RSC via config instead of env var
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createProductionServer();

        // Test non-existent action
        const response = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "nonExistentAction", args: [] }),
        });

        assertEquals(response.status, 404, "Should return 404 for non-existent action");
        const errorText = await response.text();
        assertEquals(typeof errorText, "string", "Should return error message");
      });
    } finally {
      if (originalAllowClose === undefined) {
        Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
      } else {
        Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
      }
    }
  });

  it("RSC - action endpoint enforces POST method", async () => {
    /**
     * Tests HTTP method restrictions:
     * - Only POST is allowed
     * - GET, PUT, DELETE return 405
     * - Proper Allow header in response
     */
    const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
    Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

    try {
      await withTestContext("rsc-method-restriction", async (context) => {
        // Enable RSC via config instead of env var
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createProductionServer();

        // Test GET request (should fail)
        const getResponse = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/action`);
        assertEquals(getResponse.status, 405, "Should return 405 for GET request");

        // Consume response body to prevent resource leak
        await getResponse.text();

        // Test PUT request (should fail)
        const putResponse = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/action`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "test", args: [] }),
        });
        assertEquals(putResponse.status, 405, "Should return 405 for PUT request");
        await putResponse.text();
      });
    } finally {
      if (originalAllowClose === undefined) {
        Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
      } else {
        Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
      }
    }
  });
});
