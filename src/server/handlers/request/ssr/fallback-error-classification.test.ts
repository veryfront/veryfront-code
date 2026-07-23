import {
  BUILD_FAILED,
  CACHE_ERROR,
  COMPILATION_ERROR,
  COMPONENT_ERROR,
  CONFIG_PARSE_ERROR,
  DEPENDENCY_MISSING,
} from "#veryfront/errors";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isFallbackDefinitionError } from "./fallback-error-classification.ts";

describe("fallback-error-classification", () => {
  it("identifies only explicit fallback definition failures", () => {
    assertEquals(isFallbackDefinitionError(new SyntaxError("invalid source")), true);
    assertEquals(
      isFallbackDefinitionError(COMPILATION_ERROR.create({ detail: "invalid source" })),
      true,
    );
    assertEquals(
      isFallbackDefinitionError(COMPONENT_ERROR.create({ detail: "missing component" })),
      true,
    );
    assertEquals(
      isFallbackDefinitionError(DEPENDENCY_MISSING.create({ detail: "missing dependency" })),
      true,
    );
  });

  it("does not classify operational failures as invalid fallback code", () => {
    const hostile = new Proxy({}, {
      getPrototypeOf: () => {
        throw new Error("private prototype detail");
      },
    });

    assertEquals(
      isFallbackDefinitionError(BUILD_FAILED.create({ detail: "bundle cache write failed" })),
      false,
    );
    assertEquals(
      isFallbackDefinitionError(CACHE_ERROR.create({ detail: "cache unavailable" })),
      false,
    );
    assertEquals(
      isFallbackDefinitionError(CONFIG_PARSE_ERROR.create({ detail: "config unavailable" })),
      false,
    );
    assertEquals(
      isFallbackDefinitionError(new Deno.errors.PermissionDenied("permission denied")),
      false,
    );
    assertEquals(isFallbackDefinitionError(hostile), false);
  });
});
