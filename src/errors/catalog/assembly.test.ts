import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assembleErrorCatalog } from "./assembly.ts";
import { createSimpleError } from "./factory.ts";

const CONFIG_SOLUTION = createSimpleError(
  "config-not-found",
  "Configuration missing",
  "The configuration is missing.",
  ["Create the configuration file"],
);

describe("errors/catalog/assembly", () => {
  it("rejects duplicate and mismatched catalog entries", () => {
    assertThrows(
      () =>
        assembleErrorCatalog(
          [
            { "config-not-found": CONFIG_SOLUTION },
            { "config-not-found": CONFIG_SOLUTION },
          ],
          ["config-not-found"],
        ),
      TypeError,
      "Duplicate error solution",
    );
    assertThrows(
      () =>
        assembleErrorCatalog(
          [{ "build-failed": CONFIG_SOLUTION } as never],
          ["build-failed"],
        ),
      TypeError,
      "must match its catalog key",
    );
  });

  it("rejects incomplete catalog assemblies", () => {
    assertThrows(
      () =>
        assembleErrorCatalog(
          [{ "config-not-found": CONFIG_SOLUTION }],
          ["config-not-found", "build-failed"],
        ),
      TypeError,
      "Missing error solution",
    );
  });

  it("returns an immutable checked catalog", () => {
    const catalog = assembleErrorCatalog(
      [{ "config-not-found": CONFIG_SOLUTION }],
      ["config-not-found"],
    );

    assertEquals(Object.isFrozen(catalog), true);
    assertEquals(Object.getPrototypeOf(catalog), null);
    assertStrictEquals(catalog["config-not-found"], CONFIG_SOLUTION);
  });
});
