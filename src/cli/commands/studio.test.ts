/**
 * Unit tests for studio command
 * @module cli/commands/studio.test
 */

import { assertEquals, assertStringIncludes } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { buildStudioUrl } from "./studio.ts";

describe("buildStudioUrl", () => {
  it("builds URL with project only", () => {
    assertEquals(
      buildStudioUrl("myproject"),
      "https://veryfront.com/projects/myproject",
    );
  });

  it("adds branch param", () => {
    assertEquals(
      buildStudioUrl("myproject", { branch: "main" }),
      "https://veryfront.com/projects/myproject?branch=main",
    );
  });

  it("adds file as path param", () => {
    const url = buildStudioUrl("myproject", { file: "/pages/index.mdx" });
    assertStringIncludes(url, "path=%2Fpages%2Findex.mdx");
  });

  it("combines branch and file params", () => {
    const url = buildStudioUrl("myproject", {
      branch: "main",
      file: "/pages/index.mdx",
    });
    assertStringIncludes(url, "branch=main");
    assertStringIncludes(url, "path=%2Fpages%2Findex.mdx");
  });

  it("encodes special characters in project slug", () => {
    assertEquals(
      buildStudioUrl("my project"),
      "https://veryfront.com/projects/my%20project",
    );
  });

  it("handles empty options", () => {
    assertEquals(
      buildStudioUrl("test", {}),
      "https://veryfront.com/projects/test",
    );
  });
});
