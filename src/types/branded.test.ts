import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { Brand, EntityId, Unbrand } from "./branded.ts";

describe("Unbrand", () => {
  it("recovers the base type from branded values", () => {
    const entityId: Unbrand<EntityId> = "entity";
    const count: Unbrand<Brand<number, "Count">> = 1;

    assertEquals(entityId, "entity");
    assertEquals(count, 1);
  });
});
