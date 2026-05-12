import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  filterItemsByIdSearch,
  generateExampleFromSchema,
  getNodeTypeStyle,
} from "./WorkflowsTab.helpers.ts";

describe("WorkflowsTab helpers", () => {
  it("returns configured node styles and falls back for unknown types", () => {
    assertEquals(getNodeTypeStyle("step"), {
      badge: "bg-blue-50 text-blue-600",
      node: "bg-blue-50 border-blue-200 text-blue-700",
    });
    assertEquals(getNodeTypeStyle("unknown"), {
      badge: "bg-gray-100 text-gray-600",
      node: "bg-gray-50 border-gray-200 text-gray-700",
    });
  });

  it("filters items by id using case-insensitive search", () => {
    const items = [{ id: "Alpha" }, { id: "beta" }, { id: "gamma" }];
    assertEquals(filterItemsByIdSearch(items, "A"), [{ id: "Alpha" }, { id: "beta" }, {
      id: "gamma",
    }]);
    assertEquals(filterItemsByIdSearch(items, "BET"), [{ id: "beta" }]);
  });

  it("generates examples from nested schemas", () => {
    assertEquals(
      generateExampleFromSchema({
        type: "object",
        properties: {
          email: { type: "string" },
          url: { type: "string" },
          count: { type: "integer" },
          enabled: { type: "boolean" },
          mode: { enum: ["fast", "slow"] },
          nested: {
            type: "object",
            properties: {
              name: { type: "string", default: "preset" },
            },
          },
          tags: { type: "array" },
        },
      }),
      {
        email: "user@example.com",
        url: "https://example.com/data",
        count: 1,
        enabled: true,
        mode: "fast",
        nested: { name: "preset" },
        tags: [],
      },
    );
  });
});
