/**
 * Simplified production server test to debug resource leaks
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("Simple Production Server", () => {
  it("should serve files without resource leaks", async () => {
    await withTestContext("simple-prod", async (context) => {
      // The test context already creates directories and config in setup()
      // Just add our test file
      await writeTextFile(join(context.projectDir, "public", "test.txt"), "Hello World");

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
});
