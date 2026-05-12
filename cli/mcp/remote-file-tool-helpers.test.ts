import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildProjectApiPath,
  buildProjectFilePath,
  getBranchParam,
  slugToName,
} from "./remote-file-tool-helpers.ts";

describe("cli/mcp/remote-file-tool-helpers", () => {
  it("builds project api paths with and without branch segments", () => {
    assertEquals(buildProjectApiPath("project-1", "files"), "/project-1/files");
    assertEquals(
      buildProjectApiPath("project-1", "files", "feature-1"),
      "/project-1/branches/feature-1/files",
    );
    assertEquals(buildProjectApiPath("project-1", "/files/search"), "/project-1/files/search");
  });

  it("builds encoded project file paths", () => {
    assertEquals(
      buildProjectFilePath("project-1", "app/posts/hello world.mdx"),
      "/project-1/files/app/posts/hello%20world.mdx",
    );
  });

  it("builds branch query parameters only when present", () => {
    assertEquals(getBranchParam(), "");
    assertEquals(getBranchParam("branch-123"), "?branch_id=branch-123");
  });

  it("converts slugs into title-cased names", () => {
    assertEquals(slugToName("ai-agent"), "Ai Agent");
    assertEquals(slugToName("docs-agent-template"), "Docs Agent Template");
  });
});
