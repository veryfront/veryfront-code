import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { envToObject } from "./env-to-object.ts";

describe("platform/adapters/runtime/shared/env-to-object", () => {
  it("should convert a record with string values", () => {
    const env = { FOO: "bar", BAZ: "qux" };
    assertEquals(envToObject(env), { FOO: "bar", BAZ: "qux" });
  });

  it("should filter out undefined values", () => {
    const env: Record<string, string | undefined> = {
      KEEP: "yes",
      DROP: undefined,
      ALSO_KEEP: "ok",
    };
    assertEquals(envToObject(env), { KEEP: "yes", ALSO_KEEP: "ok" });
  });

  it("should return empty object for empty input", () => {
    assertEquals(envToObject({}), {});
  });

  it("should return empty object when all values are undefined", () => {
    const env: Record<string, string | undefined> = {
      A: undefined,
      B: undefined,
    };
    assertEquals(envToObject(env), {});
  });

  it("should preserve empty string values", () => {
    assertEquals(envToObject({ EMPTY: "" }), { EMPTY: "" });
  });

  it("should handle keys with special characters", () => {
    const env = { "MY_VAR-1": "val", "some.dotted.key": "v2" };
    assertEquals(envToObject(env), { "MY_VAR-1": "val", "some.dotted.key": "v2" });
  });
});
