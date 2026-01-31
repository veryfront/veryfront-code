/**
 * Simple example to verify TestContext works correctly
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { stat } from "@veryfront/compat/fs.ts";
import { getEnv } from "@veryfront/compat/process.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("TestContext", () => {
  it("should provide basic functionality", async () => {
    await withTestContext("simple-test", async (context) => {
      const stats = await stat(context.projectDir);
      assertEquals(stats.isDirectory, true, "Project directory should exist");

      const port = await context.allocatePort();
      assertEquals(typeof port, "number", "Should allocate a port number");
      assertEquals(port >= 1024 && port <= 65535, true, "Port should be in valid range");

      context.setEnv({ TEST_VAR: "test_value" });
      assertEquals(getEnv("TEST_VAR"), "test_value", "Should set environment variable");
    });

    assertEquals(getEnv("TEST_VAR"), undefined, "Environment should be cleaned up");
  });
});
