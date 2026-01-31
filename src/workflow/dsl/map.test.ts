import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { map } from "./map.ts";
import type { WorkflowNode } from "../types.ts";

describe("workflow/dsl/map", () => {
  describe("map", () => {
    const processor: WorkflowNode = { id: "p", config: { type: "step" as const } };

    it("should create a map node with defaults", () => {
      const node = map("my-map", { items: [1, 2, 3], processor });
      assertEquals(node.id, "my-map");
      assertEquals(node.config.type, "map");
      assertEquals((node.config as { checkpoint: boolean }).checkpoint, true);
    });

    it("should throw for empty id", () => {
      assertThrows(() => map("", { items: [], processor }), Error, "non-empty");
    });

    it("should throw for missing items", () => {
      assertThrows(
        () => map("test", { items: undefined as unknown as unknown[], processor }),
        Error,
        "items",
      );
    });

    it("should throw for missing processor", () => {
      assertThrows(
        () => map("test", { items: [1], processor: undefined as unknown as WorkflowNode }),
        Error,
        "processor",
      );
    });

    it("should accept function items", () => {
      const node = map("fn-map", { items: () => [1, 2], processor });
      assertEquals(node.config.type, "map");
    });

    it("should accept concurrency option", () => {
      const node = map("conc-map", { items: [1], processor, concurrency: 5 });
      assertEquals((node.config as { concurrency: number }).concurrency, 5);
    });
  });
});
