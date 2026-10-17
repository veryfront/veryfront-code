import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isCloudEventsString, isTraceState } from "./string-validation.ts";

describe("event boundary strings", () => {
  it("accepts Unicode text and rejects controls, lone surrogates and noncharacters", () => {
    for (const value of ["", "event/type", "日本語", "😀"]) {
      assertEquals(isCloudEventsString(value), true);
    }
    for (const value of ["\n", "\x7f", "\x9f", "\ud800", "\ufdd0", "\ufffe", "\u{1ffff}"]) {
      assertEquals(isCloudEventsString(value), false);
    }
  });
  it("accepts bounded unique tracestate members and permitted surrounding whitespace", () => {
    for (const value of ["a=value", " a=value \t, b=next", "tenant@system=value", ",,a=value,,"]) {
      assertEquals(isTraceState(value), true);
    }
    for (
      const value of [
        "",
        " ",
        "a",
        "=value",
        "a=",
        "A=value",
        "a=value,a=next",
        "a=value\n",
        "a=bad=value",
        "a=" + "x".repeat(257),
        "a=" + "x".repeat(513),
        Array.from({ length: 33 }, (_, i) => `a${i}=x`).join(","),
      ]
    ) assertEquals(isTraceState(value), false);
  });
});
