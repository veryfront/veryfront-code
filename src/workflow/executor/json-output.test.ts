import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { toJsonOutput } from "./json-output.ts";

describe("toJsonOutput", () => {
  it("returns the JSON form of a selected value", () => {
    assertEquals(toJsonOutput({ category: "billing", note: undefined }), { category: "billing" });
    assertEquals(toJsonOutput(undefined), undefined);
  });

  it("rejects a value JSON cannot represent", () => {
    assertThrows(() => toJsonOutput(() => "x"), VeryfrontError, "not JSON-serializable");
    assertThrows(() => toJsonOutput({ big: 1n }), VeryfrontError, "not JSON-serializable");
  });
});
