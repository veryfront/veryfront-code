import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { map } from "./map.ts";
import type { MapNodeConfig, WorkflowNode } from "../types.ts";

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
      assertThrows(() => map("", { items: [], processor }), VeryfrontError, "non-empty");
    });

    it("should throw for missing items", () => {
      assertThrows(
        () => map("test", { items: undefined as unknown as unknown[], processor }),
        VeryfrontError,
        "items",
      );
    });

    it("should throw for missing processor", () => {
      assertThrows(
        () => map("test", { items: [1], processor: undefined as unknown as WorkflowNode }),
        VeryfrontError,
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

    it("carries every configured option onto the node config", () => {
      const skip = () => true;
      const node = map("full-map", {
        items: [1],
        processor,
        checkpoint: false,
        skip,
        retry: { maxAttempts: 2 },
        timeout: "1m",
        description: "d",
        concurrency: 3,
      });
      const config = node.config as MapNodeConfig;

      assertEquals(
        config.checkpoint,
        false,
        "an explicit checkpoint:false must be honored, not defaulted to true",
      );
      assertEquals(config.skip, skip, "the skip predicate must reach the executor's skip guard");
      assertEquals(config.retry, { maxAttempts: 2 }, "the retry policy must reach the executor");
      assertEquals(config.timeout, "1m", "the timeout must reach the executor");
      assertEquals(config.description, "d", "the description must reach the node config");
      assertEquals(config.concurrency, 3, "the concurrency must reach the executor");
    });

    it("rejects invalid concurrency", () => {
      for (const concurrency of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        assertThrows(
          () => map("invalid-concurrency", { items: [1], processor, concurrency }),
          VeryfrontError,
          "positive safe integer",
          `map must reject concurrency ${String(concurrency)}`,
        );
      }
    });
  });
});
