/**
 * Simplified production server test to debug resource leaks
 */

import { assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../_helpers/context.ts";

Deno.test("Simple Production Server - basic functionality without leaks", async () => {
  await withTestContext("simple-prod", async (context) => {
    // The test context already creates directories and config in setup()
    // Just add our test file
    await Deno.writeTextFile(join(context.projectDir, "public", "test.txt"), "Hello World");

    // Don't build - just serve
    const server = await context.createProductionServer();

    // Make request
    const response = await fetch(`http://127.0.0.1:${server.port}/test.txt`);
    assertEquals(response.status, 200, "Should serve file");

    // IMPORTANT: Consume response body to prevent leak
    const content = await response.text();
    assertEquals(content, "Hello World", "Should serve correct content");
  });
});
