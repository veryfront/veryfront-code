
import { assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../_helpers/context.ts";

Deno.test("Simple Production Server - basic functionality without leaks", async () => {
  await withTestContext("simple-prod", async (context) => {
    await Deno.writeTextFile(join(context.projectDir, "public", "test.txt"), "Hello World");

    const server = await context.createProductionServer();

    const response = await fetch(`http://localhost:${server.port}/test.txt`);
    assertEquals(response.status, 200, "Should serve file");

    const content = await response.text();
    assertEquals(content, "Hello World", "Should serve correct content");
  });
});
