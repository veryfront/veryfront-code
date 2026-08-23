/**
 * Simplified production pipeline test to guard against resource leaks
 */

import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withInProcessProject } from "../../_helpers/in-process-project.ts";

describe("Simple Production Server", () => {
  it("should serve files without resource leaks", async () => {
    await withInProcessProject("simple-prod", {
      mode: "production",
      files: { "public/test.txt": "Hello World" },
    }, async (project) => {
      const response = await project.handle("/test.txt");
      assertEquals(response.status, 200, "Should serve file");

      const content = await response.text();
      assertEquals(content, "Hello World", "Should serve correct content");
    });
  });
});
