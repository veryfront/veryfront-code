/**
 * Simplified production server test to debug resource leaks
 */

import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("Simple Production Server", () => {
  it("should serve files without resource leaks", async () => {
    await withTestContext("simple-prod", async (context) => {
      await writeTextFile(
        join(context.projectDir, "public", "test.txt"),
        "Hello World",
      );

      const server = await context.createProductionServer();

      const response = await fetch(`http://127.0.0.1:${server.port}/test.txt`);
      assertEquals(response.status, 200, "Should serve file");

      const content = await response.text();
      assertEquals(content, "Hello World", "Should serve correct content");
    });
  });
});
