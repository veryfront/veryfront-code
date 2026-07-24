import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { safeJsonParse } from "./json.ts";

describe("safeJsonParse", () => {
  it("parses a valid JSON string", () => {
    const r = safeJsonParse('{"a":1}');
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.value, { a: 1 });
  });

  it("parses a JSON number", () => {
    const r = safeJsonParse("42");
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.value, 42);
  });

  it("parses a JSON array", () => {
    const r = safeJsonParse("[1,2,3]");
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.value, [1, 2, 3]);
  });

  it("returns ok:false for invalid JSON", () => {
    const r = safeJsonParse("not json");
    assertEquals(r.ok, false);
    if (!r.ok) assertInstanceOf(r.error, Error);
  });

  it("returns ok:false for an empty string", () => {
    const r = safeJsonParse("");
    assertEquals(r.ok, false);
  });

  it("accepts a type parameter for typed results", () => {
    const r = safeJsonParse<{ name: string }>('{"name":"alice"}');
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.value.name, "alice");
  });
});
