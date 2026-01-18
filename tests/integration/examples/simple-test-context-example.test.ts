/**
 * Simple example to verify TestContext works correctly
 */

import { assertEquals } from "@std/assert";
import { withTestContext } from "../../_helpers/context.ts";

Deno.test("TestContext basic functionality", async () => {
  await withTestContext("simple-test", async (context) => {
    // Verify project directory is created
    const stats = await Deno.stat(context.projectDir);
    assertEquals(stats.isDirectory, true, "Project directory should exist");

    // Verify we can allocate a port
    const port = await context.allocatePort();
    assertEquals(typeof port, "number", "Should allocate a port number");
    // Default range is 10000-60000, but can be overridden via TEST_PORT_MIN/MAX
    assertEquals(port >= 1024 && port <= 65535, true, "Port should be in valid range");

    // Verify environment variable management
    context.setEnv({ TEST_VAR: "test_value" });
    assertEquals(Deno.env.get("TEST_VAR"), "test_value", "Should set environment variable");
  });

  // Verify cleanup - env var should be restored
  assertEquals(Deno.env.get("TEST_VAR"), undefined, "Environment should be cleaned up");
});
