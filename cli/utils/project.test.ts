/**
 * Tests for project utilities
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateDefaultProjectId } from "./project.ts";

describe("project utilities", () => {
  describe("generateDefaultProjectId", () => {
    it("generates id from directory name", () => {
      const result = generateDefaultProjectId("/path/to/my-project");
      assertEquals(result, "local-my-project");
    });

    it("handles directory with special characters", () => {
      const result = generateDefaultProjectId("/path/to/My Project!");
      assertEquals(result, "local-my-project-");
    });

    it("converts uppercase to lowercase", () => {
      const result = generateDefaultProjectId("/path/to/MyProject");
      assertEquals(result, "local-myproject");
    });

    it("handles directory with numbers", () => {
      const result = generateDefaultProjectId("/path/to/project123");
      assertEquals(result, "local-project123");
    });

    it("handles directory with underscores", () => {
      const result = generateDefaultProjectId("/path/to/my_project");
      assertEquals(result, "local-my_project");
    });

    it("handles directory with hyphens", () => {
      const result = generateDefaultProjectId("/path/to/my-awesome-project");
      assertEquals(result, "local-my-awesome-project");
    });

    it("handles root directory", () => {
      const result = generateDefaultProjectId("/");
      assertEquals(result, "local-");
    });

    it("handles simple directory name", () => {
      const result = generateDefaultProjectId("myapp");
      assertEquals(result, "local-myapp");
    });
  });
});
