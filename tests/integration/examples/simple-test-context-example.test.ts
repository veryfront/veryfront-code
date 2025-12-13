
import { assertEquals } from "std/assert/mod.ts";
import { withTestContext } from "../../_helpers/context.ts";

Deno.test("TestContext basic functionality", async () => {
  await withTestContext("simple-test", async (context) => {
    const stats = await Deno.stat(context.projectDir);
    assertEquals(stats.isDirectory, true, "Project directory should exist");

    const port = await context.allocatePort();
    assertEquals(typeof port, "number", "Should allocate a port number");
    assertEquals(port >= 9000 && port <= 12000, true, "Port should be in valid range");

    context.setEnv({ TEST_VAR: "test_value" });
    assertEquals(Deno.env.get("TEST_VAR"), "test_value", "Should set environment variable");
  });

  assertEquals(Deno.env.get("TEST_VAR"), undefined, "Environment should be cleaned up");
});
