import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deriveTaskId } from "./discovery.ts";
import { isTaskDefinition } from "./types.ts";

describe("src/task/discovery", () => {
  describe("deriveTaskId", () => {
    it("should strip tasksDir prefix and extension", () => {
      assertEquals(deriveTaskId("tasks/sync-data.ts", "tasks"), "sync-data");
    });

    it("should handle trailing slash in tasksDir", () => {
      assertEquals(deriveTaskId("tasks/sync-data.ts", "tasks/"), "sync-data");
    });

    it("should handle nested file paths", () => {
      assertEquals(
        deriveTaskId("tasks/reports/daily.ts", "tasks"),
        "reports/daily",
      );
    });

    it("should handle .tsx extension", () => {
      assertEquals(deriveTaskId("tasks/render.tsx", "tasks"), "render");
    });

    it("should handle .js extension", () => {
      assertEquals(deriveTaskId("tasks/legacy.js", "tasks"), "legacy");
    });

    it("should handle .jsx extension", () => {
      assertEquals(deriveTaskId("tasks/component.jsx", "tasks"), "component");
    });

    it("should handle absolute paths", () => {
      assertEquals(
        deriveTaskId("/project/tasks/cleanup.ts", "/project/tasks"),
        "cleanup",
      );
    });

    it("should return path as-is when prefix does not match", () => {
      assertEquals(
        deriveTaskId("other/cleanup.ts", "tasks"),
        "other/cleanup",
      );
    });
  });

  describe("isTaskDefinition", () => {
    it("should return true for an object with a run function", () => {
      assertEquals(
        isTaskDefinition({ run: () => {} }),
        true,
      );
    });

    it("should return true for a full task definition", () => {
      assertEquals(
        isTaskDefinition({
          name: "My Task",
          description: "Does things",
          run: async () => ({ ok: true }),
        }),
        true,
      );
    });

    it("should return false for null", () => {
      assertEquals(isTaskDefinition(null), false);
    });

    it("should return false for undefined", () => {
      assertEquals(isTaskDefinition(undefined), false);
    });

    it("should return false for a string", () => {
      assertEquals(isTaskDefinition("not a task"), false);
    });

    it("should return false for a number", () => {
      assertEquals(isTaskDefinition(42), false);
    });

    it("should return false for an object without run", () => {
      assertEquals(isTaskDefinition({ name: "no run" }), false);
    });

    it("should return false when run is not a function", () => {
      assertEquals(isTaskDefinition({ run: "not a function" }), false);
    });
  });
});
