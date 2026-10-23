import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createZodAdapter } from "./adapter.ts";

describe("SchemaValidator constrained collections", () => {
  it("rejects an oversized array before validating its elements", () => {
    const validator = createZodAdapter();
    let elementChecks = 0;
    const element = validator.string().refine(() => {
      elementChecks++;
      return true;
    });
    const result = validator.array(element).max(2).safeParse(["a", "b", "c"]);

    assert(!result.success);
    assertEquals(elementChecks, 0);
    assertEquals(result.issues.map(({ code, path }) => ({ code, path })), [
      { code: "too_big", path: [] },
    ]);
  });

  it("preserves valid and invalid element validation within the bound", () => {
    const validator = createZodAdapter();
    let elementChecks = 0;
    const element = validator.string().refine((value) => {
      elementChecks++;
      return value !== "bad";
    }, "Element refused");
    const schema = validator.array(element).max(2);
    const valid = schema.safeParse(["a", "b"]);
    assert(valid.success);
    assertEquals(valid.data, ["a", "b"]);
    assertEquals(elementChecks, 2);

    elementChecks = 0;
    const invalid = schema.safeParse(["bad"]);
    assert(!invalid.success);
    assertEquals(elementChecks, 1);
    assertEquals(invalid.issues.map(({ code, path }) => ({ code, path })), [
      { code: "custom", path: [0] },
    ]);
  });
});
